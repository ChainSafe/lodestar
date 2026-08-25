import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {atomicWrite} from "./atomicWrite.js";
import {
  DCOL_HEADER_SIZE,
  type DcolHeader,
  encodeDcolFile,
  getColumnByteRange,
  mergeDcolColumns,
  offsetTableSize,
  parseDcolHeader,
  readAllColumns,
  totalBits,
} from "./dcolFormat.js";
import {DataColumnStoreError, DataColumnStoreErrorCode, isFsNotFoundError} from "./errors.js";
import {type FlatFileStoreMetrics, FlatFileStoreOperation, observeFlatFileStoreOperation} from "./metrics.js";
import {assertValidRootHex, padSlot} from "./path.js";
import {SlotIndex} from "./slotIndex.js";
import {uncompress} from "./snappy.js";

/**
 * Filesystem data column store using `.dcol` format.
 *
 * Layout: `<baseDir>/data_columns/<padSlot>/0x<rootHex>.dcol`
 *
 * Per-root write locking via promise chaining to handle concurrent incremental writes.
 */
export class ColumnStore {
  readonly dir: string;
  /** Per-root write lock: serializes concurrent writes to the same file */
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(
    baseDir: string,
    private readonly config: ChainForkConfig,
    private readonly slotIndex: SlotIndex,
    private readonly metrics: FlatFileStoreMetrics | null
  ) {
    this.dir = path.join(baseDir, "data_columns");
  }

  private filePath(slot: Slot, rootHex: RootHex): string {
    assertValidRootHex(rootHex);
    return path.join(this.dir, padSlot(slot), `${rootHex}.dcol`);
  }

  private lockKey(slot: Slot, rootHex: RootHex): string {
    return `${slot}:${rootHex}`;
  }

  /**
   * Acquire a write lock for a (slot, root) pair.
   * Returns a release function to call when done.
   */
  private acquireLock(slot: Slot, rootHex: RootHex): Promise<() => void> {
    const key = this.lockKey(slot, rootHex);
    let release!: () => void;
    const prev = this.writeLocks.get(key) ?? Promise.resolve();
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.writeLocks.set(key, chained);

    return prev.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        if (this.writeLocks.get(key) === chained) {
          this.writeLocks.delete(key);
        }
      };
    });
  }

  /**
   * Read the entire dcol file from disk.
   */
  private async readFile(slot: Slot, rootHex: RootHex): Promise<Uint8Array | null> {
    try {
      return await fs.promises.readFile(this.filePath(slot, rootHex));
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
      return null;
    }
  }

  /**
   * Get deserialized data column sidecars.
   */
  async getColumns(slot: Slot, rootHex: RootHex): Promise<DataColumnSidecar[]> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.read, async () => {
      const data = await this.readFile(slot, rootHex);
      if (!data) return [];

      this.metrics?.readBytes.inc(data.length);
      const header = parseDcolHeader(data);
      validateDcolHeader(header, slot, rootHex);
      const columns = readAllColumns(data, header);
      const dataColumnSidecarType = this.config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;

      return columns.map((col) => dataColumnSidecarType.deserialize(col.data));
    });
  }

  /**
   * Get binary column data for specific indices.
   * Uses targeted fd.read() to avoid reading the entire file.
   */
  async getColumnsBinary(slot: Slot, rootHex: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.read, () =>
      this.getColumnsBinaryUninstrumented(slot, rootHex, indices)
    );
  }

  private async getColumnsBinaryUninstrumented(
    slot: Slot,
    rootHex: RootHex,
    indices: number[]
  ): Promise<(Uint8Array | undefined)[]> {
    let fd: fs.promises.FileHandle;
    try {
      fd = await fs.promises.open(this.filePath(slot, rootHex), "r");
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
      return indices.map(() => undefined);
    }

    try {
      const headerBuf = new Uint8Array(DCOL_HEADER_SIZE);
      await readExactly(fd, headerBuf, 0);
      this.metrics?.readBytes.inc(headerBuf.length);
      const header = parseDcolHeader(headerBuf);
      validateDcolHeader(header, slot, rootHex);

      const N = totalBits(header.bitmap);
      const tableSize = offsetTableSize(N);
      const offsetTable = new Uint8Array(tableSize);
      await readExactly(fd, offsetTable, DCOL_HEADER_SIZE);
      this.metrics?.readBytes.inc(offsetTable.length);
      const fileSize = (await fd.stat()).size;

      const results: (Uint8Array | undefined)[] = [];
      for (const idx of indices) {
        const range = getColumnByteRange(header, offsetTable, idx);
        if (!range) {
          results.push(undefined);
          continue;
        }
        if (range.length < 0 || range.offset + range.length > fileSize) {
          throw new DataColumnStoreError(
            {code: DataColumnStoreErrorCode.INVALID_OFFSET, slot, root: rootHex, index: idx},
            `Invalid dcol offset for slot=${slot} root=${rootHex} index=${idx}`
          );
        }
        const buf = new Uint8Array(range.length);
        await readExactly(fd, buf, range.offset);
        this.metrics?.readBytes.inc(buf.length);
        results.push(uncompress(buf));
      }

      return results;
    } finally {
      await fd.close();
    }
  }

  /**
   * Put binary columns. Merges with existing file if present.
   * Uses per-root locking for thread safety.
   */
  async putColumnsBinary(
    slot: Slot,
    rootHex: RootHex,
    blockRoot: Uint8Array,
    columns: {index: number; data: Uint8Array}[]
  ): Promise<void> {
    if (columns.length === 0) return;

    await observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.write, async () => {
      const release = await this.acquireLock(slot, rootHex);
      try {
        const existing = await this.readFile(slot, rootHex);
        let fileData: Uint8Array;

        if (existing) {
          this.metrics?.readBytes.inc(existing.length);
          const header = parseDcolHeader(existing);
          validateDcolHeader(header, slot, rootHex);
          fileData = mergeDcolColumns(existing, columns);
        } else {
          fileData = encodeDcolFile(blockRoot, slot, columns);
        }

        await atomicWrite(this.filePath(slot, rootHex), fileData);
        this.metrics?.writeBytes.inc(fileData.length);
        this.slotIndex.add(slot);
      } finally {
        release();
      }
    });
  }

  /**
   * Delete all columns for a (slot, root).
   */
  async delete(slot: Slot, rootHex: RootHex): Promise<void> {
    await observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.delete, async () => {
      const release = await this.acquireLock(slot, rootHex);
      try {
        await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
      } finally {
        release();
      }
    });
  }

  /**
   * Delete all slot directories with slot < minSlot.
   */
  async pruneBeforeSlot(minSlot: Slot): Promise<void> {
    await observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.prune, async () => {
      for (const slot of this.slotIndex.getBefore(minSlot)) {
        await fs.promises.rm(path.join(this.dir, padSlot(slot)), {recursive: true, force: true});
        this.slotIndex.remove(slot);
        this.metrics?.prunedDirectories.inc();
      }
    });
  }
}

function validateDcolHeader(header: DcolHeader, slot: Slot, rootHex: RootHex): void {
  if (header.slot !== slot) {
    throw new DataColumnStoreError(
      {code: DataColumnStoreErrorCode.SLOT_MISMATCH, headerSlot: header.slot, pathSlot: slot},
      `Dcol slot mismatch: header=${header.slot} path=${slot}`
    );
  }
  const headerRoot = toRootHex(header.blockRoot);
  if (headerRoot !== rootHex) {
    throw new DataColumnStoreError(
      {code: DataColumnStoreErrorCode.ROOT_MISMATCH, headerRoot, pathRoot: rootHex},
      `Dcol block root mismatch: header=${headerRoot} path=${rootHex}`
    );
  }
}

async function readExactly(fd: fs.promises.FileHandle, buffer: Uint8Array, position: number): Promise<void> {
  let totalRead = 0;
  while (totalRead < buffer.length) {
    const {bytesRead} = await fd.read(buffer, totalRead, buffer.length - totalRead, position + totalRead);
    if (bytesRead === 0) {
      const offset = position + totalRead;
      throw new DataColumnStoreError(
        {code: DataColumnStoreErrorCode.UNEXPECTED_EOF, offset},
        `Unexpected end of dcol file at offset ${offset}`
      );
    }
    totalRead += bytesRead;
  }
}
