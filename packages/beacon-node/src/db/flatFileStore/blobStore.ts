import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {atomicWrite, padSlot} from "./atomicWrite.js";
import {ExistenceCache} from "./existenceCache.js";

/**
 * Filesystem blob store.
 *
 * Layout: `<baseDir>/blob_sidecars/<padSlot>/0x<rootHex>.ssz`
 *
 * Each file contains the raw BlobSidecarsWrapper bytes (same format as LevelDB).
 */
export class BlobStore {
  readonly dir: string;
  /** Per-root lock to serialize put/delete for the same blob file */
  private readonly writeLocks = new Map<string, Promise<void>>();

  constructor(
    baseDir: string,
    private readonly cache: ExistenceCache
  ) {
    this.dir = path.join(baseDir, "blob_sidecars");
  }

  private filePath(slot: Slot, rootHex: RootHex): string {
    return path.join(this.dir, padSlot(slot), `${rootHex}.ssz`);
  }

  private lockKey(slot: Slot, rootHex: RootHex): string {
    return `${slot}:${rootHex}`;
  }

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

  async getBinary(slot: Slot, rootHex: RootHex): Promise<Uint8Array | null> {
    try {
      return await fs.promises.readFile(this.filePath(slot, rootHex));
    } catch (_e) {
      return null;
    }
  }

  async put(slot: Slot, rootHex: RootHex, data: Uint8Array): Promise<void> {
    const release = await this.acquireLock(slot, rootHex);
    try {
      await atomicWrite(this.filePath(slot, rootHex), data);
      this.cache.setBlobPresent(slot, rootHex);
    } finally {
      release();
    }
  }

  async delete(slot: Slot, rootHex: RootHex): Promise<void> {
    const release = await this.acquireLock(slot, rootHex);
    try {
      try {
        await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
      } catch (_e) {
        // File may not exist
      }
      this.cache.removeBlobPresent(slot, rootHex);
    } finally {
      release();
    }
  }

  has(slot: Slot, rootHex: RootHex): boolean {
    return this.cache.hasBlobPresent(slot, rootHex);
  }

  /**
   * Stream binary entries for a slot range [gte, lt).
   * Reads slot directories in order.
   */
  async *streamBinaryEntries(gte: Slot, lt: Slot): AsyncIterable<{slot: Slot; data: Uint8Array}> {
    let slotDirs: string[];
    try {
      slotDirs = await fs.promises.readdir(this.dir);
    } catch (_e) {
      return;
    }

    // Sort lexicographically (padded slots sort correctly)
    slotDirs.sort();

    for (const slotStr of slotDirs) {
      const slot = Number.parseInt(slotStr, 10);
      if (Number.isNaN(slot)) continue;
      if (slot < gte) continue;
      if (slot >= lt) break;

      const slotDir = path.join(this.dir, slotStr);
      const files = await fs.promises.readdir(slotDir);
      for (const file of files) {
        if (file.endsWith(".ssz") && file.startsWith("0x")) {
          const filePath = path.join(slotDir, file);
          const data = await fs.promises.readFile(filePath);
          yield {slot, data};
        }
      }
    }
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

  /**
   * Find and return the first file for a given slot (canonical lookup by slot only).
   * Checks the existence cache first to avoid a readdir syscall.
   */
  async getBinaryBySlot(slot: Slot): Promise<Uint8Array | null> {
    // Fast path: existence cache knows which root lives at this slot
    const cachedRoot = this.cache.getAnyRootForSlot(slot);
    if (cachedRoot) {
      return this.getBinary(slot, cachedRoot);
    }

    // Slow path: readdir the slot directory
    const slotDir = path.join(this.dir, padSlot(slot));
    try {
      const files = await fs.promises.readdir(slotDir);
      for (const file of files) {
        if (file.endsWith(".ssz") && file.startsWith("0x")) {
          return await fs.promises.readFile(path.join(slotDir, file));
        }
      }
    } catch (_e) {
      // Directory doesn't exist
    }
    return null;
  }
}
