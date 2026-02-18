import fs from "node:fs";
import path from "node:path";
import {uncompress} from "snappyjs";
import {RootHex, Slot, fulu, ssz} from "@lodestar/types";
import {atomicWrite, padSlot} from "./atomicWrite.js";
import {
  DCOL_HEADER_SIZE,
  encodeDcolFile,
  getColumnByteRange,
  mergeDcolColumns,
  offsetTableSize,
  parseDcolHeader,
  readAllColumns,
  totalBits,
} from "./dcolFormat.js";
import {ExistenceCache} from "./existenceCache.js";

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
    private readonly cache: ExistenceCache
  ) {
    this.dir = path.join(baseDir, "data_columns");
  }

  private filePath(slot: Slot, rootHex: RootHex): string {
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
    } catch (_e) {
      return null;
    }
  }

  /**
   * Get deserialized data column sidecars.
   */
  async getColumns(slot: Slot, rootHex: RootHex): Promise<fulu.DataColumnSidecar[]> {
    const data = await this.readFile(slot, rootHex);
    if (!data) return [];

    const header = parseDcolHeader(data);
    const columns = readAllColumns(data, header);

    return columns.map((col) => ssz.fulu.DataColumnSidecar.deserialize(col.data));
  }

  /**
   * Get binary column data for specific indices.
   * Uses targeted fd.read() to avoid reading the entire file.
   */
  async getColumnsBinary(slot: Slot, rootHex: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    let fd: fs.promises.FileHandle;
    try {
      fd = await fs.promises.open(this.filePath(slot, rootHex), "r");
    } catch (_e) {
      return indices.map(() => undefined);
    }

    try {
      // Read header (149 bytes)
      const headerBuf = new Uint8Array(DCOL_HEADER_SIZE);
      await fd.read(headerBuf, 0, DCOL_HEADER_SIZE, 0);
      const header = parseDcolHeader(headerBuf);

      // Read the offset table
      const N = totalBits(header.bitmap);
      const tableSize = offsetTableSize(N);
      const offsetTable = new Uint8Array(tableSize);
      await fd.read(offsetTable, 0, tableSize, DCOL_HEADER_SIZE);

      // Read each requested column via targeted pread
      const results: (Uint8Array | undefined)[] = [];
      for (const idx of indices) {
        const range = getColumnByteRange(header, offsetTable, idx);
        if (!range) {
          results.push(undefined);
          continue;
        }
        const buf = new Uint8Array(range.length);
        await fd.read(buf, 0, range.length, range.offset);
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

    const release = await this.acquireLock(slot, rootHex);
    try {
      const existing = await this.readFile(slot, rootHex);
      let fileData: Uint8Array;

      if (existing && existing.length >= DCOL_HEADER_SIZE) {
        fileData = mergeDcolColumns(existing, columns);
      } else {
        fileData = encodeDcolFile(blockRoot, slot, columns);
      }

      await atomicWrite(this.filePath(slot, rootHex), fileData);
      this.cache.setColumnsPresent(
        slot,
        rootHex,
        columns.map((c) => c.index)
      );
    } finally {
      release();
    }
  }

  /**
   * Delete all columns for a (slot, root).
   */
  async delete(slot: Slot, rootHex: RootHex): Promise<void> {
    const release = await this.acquireLock(slot, rootHex);
    try {
      try {
        await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
      } catch (_e) {
        // File may not exist
      }
      this.cache.removeColumns(slot, rootHex);
    } finally {
      release();
    }
  }

  hasColumn(slot: Slot, rootHex: RootHex, index: number): boolean {
    return this.cache.hasColumnPresent(slot, rootHex, index);
  }

  getColumnBitmap(slot: Slot, rootHex: RootHex): bigint | null {
    return this.cache.getColumnBitmap(slot, rootHex);
  }

  /**
   * Get binary columns by slot only (for finalized canonical lookups).
   * Checks the existence cache first to avoid a readdir syscall.
   */
  async getColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    // Fast path: existence cache knows which root lives at this slot
    const cachedRoot = this.cache.getAnyRootForSlot(slot);
    if (cachedRoot) {
      return this.getColumnsBinary(slot, cachedRoot, indices);
    }

    // Slow path: readdir the slot directory
    const slotDir = path.join(this.dir, padSlot(slot));
    try {
      const files = await fs.promises.readdir(slotDir);
      for (const file of files) {
        if (file.endsWith(".dcol") && file.startsWith("0x")) {
          const rootHex = file.slice(0, -5);
          return this.getColumnsBinary(slot, rootHex, indices);
        }
      }
    } catch (_e) {
      // Directory doesn't exist
    }
    return indices.map(() => undefined);
  }

  /**
   * Delete all slot directories with slot < minSlot.
   */
  async pruneBeforeSlot(minSlot: Slot): Promise<void> {
    let slotDirs: string[];
    try {
      slotDirs = await fs.promises.readdir(this.dir);
    } catch (_e) {
      return;
    }

    for (const slotStr of slotDirs) {
      const slot = Number.parseInt(slotStr, 10);
      if (Number.isNaN(slot)) continue;
      if (slot < minSlot) {
        await fs.promises.rm(path.join(this.dir, slotStr), {recursive: true, force: true});
      }
    }

    this.cache.evictBelow(minSlot);
  }
}
