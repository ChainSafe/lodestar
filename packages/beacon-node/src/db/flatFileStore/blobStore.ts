import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {atomicWrite, padSlot} from "./atomicWrite.js";
import {isFsNotFoundError} from "./errors.js";
import {ExistenceCache} from "./existenceCache.js";
import {removeSlotDirectories} from "./slotDirectory.js";

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
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
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
      await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
      this.cache.removeBlobPresent(slot, rootHex);
    } finally {
      release();
    }
  }

  has(slot: Slot, rootHex: RootHex): boolean {
    return this.cache.hasBlobPresent(slot, rootHex);
  }

  /**
   * Delete all slot directories with slot < minSlot.
   */
  async pruneBeforeSlot(minSlot: Slot): Promise<void> {
    await removeSlotDirectories(this.dir, (slot) => slot < minSlot);
    this.cache.evictBlobsBelow(minSlot);
  }

  /**
   * Return data only when exactly one blob root exists for the slot.
   * Checks the existence cache first to avoid a readdir syscall.
   */
  async getBinaryBySlot(slot: Slot): Promise<Uint8Array | null> {
    const cachedRoot = this.cache.getUniqueBlobRootForSlot(slot);
    if (cachedRoot) {
      return this.getBinary(slot, cachedRoot);
    }

    const slotDir = path.join(this.dir, padSlot(slot));
    try {
      const files = await fs.promises.readdir(slotDir);
      const blobFiles = files.filter((file) => file.endsWith(".ssz") && file.startsWith("0x"));
      if (blobFiles.length === 1) return await fs.promises.readFile(path.join(slotDir, blobFiles[0]));
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
    }
    return null;
  }
}
