import fs from "node:fs";
import path from "node:path";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex, toRootHex} from "@lodestar/utils";
import {atomicWrite, mkdirDurable} from "./atomicWrite.js";
import {
  DCOL_HEADER_SIZE,
  type DcolHeader,
  encodeDcolFile,
  getColumnByteRange,
  mergeDcolColumns,
  offsetTableSize,
  parseDcolHeader,
  parseDcolOffsets,
  readAllColumns,
  totalBits,
} from "./dcolFormat.js";
import {DataColumnStoreError, DataColumnStoreErrorCode, isFsNotFoundError} from "./errors.js";
import type {IFlatFileStore} from "./interface.js";
import {type FlatFileStoreMetrics, FlatFileStoreOperation, observeFlatFileStoreOperation} from "./metrics.js";
import {assertValidRootHex, padSlot} from "./path.js";
import {SlotIndex} from "./slotIndex.js";
import {uncompress} from "./snappy.js";

/**
 * Filesystem storage for data columns, keyed by slot and block root.
 * Hot and finalized data share the same layout. The top-level slot index is rebuilt on startup
 * without inspecting the contents of slot directories.
 * Per-slot mutation locking coordinates incremental writes, deletion, and pruning.
 */
export class FlatFileStore implements IFlatFileStore {
  private readonly slotIndex = new SlotIndex();
  private readonly mutationLocks = new Map<Slot, Promise<void>>();
  private minRetainedSlot: Slot = 0;
  private metrics: FlatFileStoreMetrics | null = null;

  constructor(
    private readonly dataColumnDir: string,
    private readonly config: ChainForkConfig,
    private readonly logger: Logger,
    metrics: FlatFileStoreMetrics | null = null
  ) {
    this.setMetrics(metrics);
  }

  setMetrics(metrics: FlatFileStoreMetrics | null): void {
    if (metrics === this.metrics) return;
    this.metrics = metrics;
    metrics?.slotIndexSize.addCollect((metric) => metric.set(this.slotIndex.size));
  }

  async init(): Promise<void> {
    const endTimer = this.metrics?.startupDuration.startTimer();
    try {
      await mkdirDurable(this.dataColumnDir);
      const stats = await this.slotIndex.rebuildFromDisk(this.dataColumnDir);
      if (stats.ignoredEntries > 0) {
        this.logger.warn("Ignored non-canonical flat file store entries", {
          entries: stats.ignoredEntries,
        });
      }
      this.logger.info("Flat file store initialized", {
        slots: stats.slots,
      });
    } catch (e) {
      this.metrics?.startupErrors.inc();
      if (e instanceof DataColumnStoreError) {
        throw e;
      }
      throw new DataColumnStoreError(
        {code: DataColumnStoreErrorCode.STARTUP_FAILED},
        "Flat file store initialization failed",
        e
      );
    } finally {
      endTimer?.();
    }
  }

  async close(): Promise<void> {
    // All operations are stateless file I/O.
  }

  async getDataColumns(slot: Slot, blockRoot: RootHex): Promise<DataColumnSidecar[]> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.read, async () => {
      const data = await this.readFile(slot, blockRoot);
      if (!data) return [];

      this.metrics?.readBytes.inc(data.length);
      const header = parseDcolHeader(data);
      validateDcolHeader(header, slot, blockRoot);
      const columns = readAllColumns(data, header);
      const dataColumnSidecarType = this.config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;

      return columns.map((col) => dataColumnSidecarType.deserialize(col.data));
    });
  }

  async getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.read, () =>
      this.getColumnsBinaryUninstrumented(slot, blockRoot, indices)
    );
  }

  async putDataColumnsBinary(
    slot: Slot,
    blockRoot: RootHex,
    columns: {index: number; data: Uint8Array}[]
  ): Promise<void> {
    const rootBytes = fromHex(blockRoot);
    if (columns.length === 0) return;

    await observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.write, async () => {
      const release = await this.acquireMutationLock(slot);
      try {
        if (slot < this.minRetainedSlot) {
          throw new DataColumnStoreError(
            {code: DataColumnStoreErrorCode.SLOT_PRUNED, slot, minRetainedSlot: this.minRetainedSlot},
            `Cannot write pruned data column slot=${slot} minRetainedSlot=${this.minRetainedSlot}`
          );
        }
        const existing = await this.readFile(slot, blockRoot);
        let fileData: Uint8Array;

        if (existing) {
          this.metrics?.readBytes.inc(existing.length);
          const header = parseDcolHeader(existing);
          validateDcolHeader(header, slot, blockRoot);
          fileData = mergeDcolColumns(existing, columns);
        } else {
          fileData = encodeDcolFile(rootBytes, slot, columns);
        }

        await atomicWrite(this.filePath(slot, blockRoot), fileData);
        this.metrics?.writeBytes.inc(fileData.length);
        this.slotIndex.add(slot);
      } finally {
        release();
      }
    });
  }

  async deleteMany(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void> {
    const results = await Promise.allSettled(items.map(({slot, blockRoot}) => this.delete(slot, blockRoot)));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new DataColumnStoreError(
        {code: DataColumnStoreErrorCode.BATCH_DELETE_FAILED, failures: errors.length},
        "Failed to delete flat file data",
        new AggregateError(errors)
      );
    }
  }

  async pruneBefore(minSlot: Slot): Promise<Slot[]> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.prune, async () => {
      this.minRetainedSlot = Math.max(this.minRetainedSlot, minSlot);
      const slotsToPrune = new Set(this.slotIndex.getBefore(this.minRetainedSlot));
      for (const slot of this.mutationLocks.keys()) {
        if (slot < this.minRetainedSlot) slotsToPrune.add(slot);
      }

      for (const slot of slotsToPrune) {
        const release = await this.acquireMutationLock(slot);
        try {
          await fs.promises.rm(path.join(this.dataColumnDir, padSlot(slot)), {recursive: true, force: true});
          this.slotIndex.remove(slot);
          this.metrics?.prunedDirectories.inc();
        } finally {
          release();
        }
      }
      return [...slotsToPrune].sort((a, b) => a - b);
    });
  }

  private filePath(slot: Slot, rootHex: RootHex): string {
    assertValidRootHex(rootHex);
    return path.join(this.dataColumnDir, padSlot(slot), `${rootHex}.dcol`);
  }

  private acquireMutationLock(slot: Slot): Promise<() => void> {
    let release!: () => void;
    const prev = this.mutationLocks.get(slot) ?? Promise.resolve();
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.mutationLocks.set(slot, chained);

    return prev.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
        if (this.mutationLocks.get(slot) === chained) {
          this.mutationLocks.delete(slot);
        }
      };
    });
  }

  private async readFile(slot: Slot, rootHex: RootHex): Promise<Uint8Array | null> {
    try {
      return await fs.promises.readFile(this.filePath(slot, rootHex));
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
      return null;
    }
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
      const offsets = parseDcolOffsets(offsetTable, N, fileSize - DCOL_HEADER_SIZE - tableSize);

      const results: (Uint8Array | undefined)[] = [];
      for (const idx of indices) {
        const range = getColumnByteRange(header, offsets, idx);
        if (!range) {
          results.push(undefined);
          continue;
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

  private async delete(slot: Slot, rootHex: RootHex): Promise<void> {
    await observeFlatFileStoreOperation(this.metrics, FlatFileStoreOperation.delete, async () => {
      const release = await this.acquireMutationLock(slot);
      try {
        await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
      } finally {
        release();
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
