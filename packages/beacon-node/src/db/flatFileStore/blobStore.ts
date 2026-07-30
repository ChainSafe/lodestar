import fs from "node:fs";
import path from "node:path";
import {RootHex, Slot} from "@lodestar/types";
import {atomicWrite, padSlot} from "./atomicWrite.js";
import {isFsNotFoundError} from "./errors.js";
import {ExistenceCache} from "./existenceCache.js";
import {
  type FlatFileStoreMetrics,
  FlatFileStoreOperation,
  FlatFileStoreType,
  observeFlatFileStoreOperation,
} from "./metrics.js";

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
    private readonly cache: ExistenceCache,
    private readonly metrics: FlatFileStoreMetrics | null
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

  private async readPath(filePath: string): Promise<Uint8Array | null> {
    try {
      const data = await fs.promises.readFile(filePath);
      this.metrics?.readBytes.inc({store: FlatFileStoreType.blob}, data.length);
      return data;
    } catch (e) {
      if (!isFsNotFoundError(e)) throw e;
      return null;
    }
  }

  async getBinary(slot: Slot, rootHex: RootHex): Promise<Uint8Array | null> {
    return observeFlatFileStoreOperation(this.metrics, FlatFileStoreType.blob, FlatFileStoreOperation.read, () =>
      this.readPath(this.filePath(slot, rootHex))
    );
  }

  async put(slot: Slot, rootHex: RootHex, data: Uint8Array): Promise<void> {
    await observeFlatFileStoreOperation(
      this.metrics,
      FlatFileStoreType.blob,
      FlatFileStoreOperation.write,
      async () => {
        const release = await this.acquireLock(slot, rootHex);
        try {
          await atomicWrite(this.filePath(slot, rootHex), data);
          this.metrics?.writeBytes.inc({store: FlatFileStoreType.blob}, data.length);
          this.cache.setBlobPresent(slot, rootHex);
          this.metrics?.files.set({store: FlatFileStoreType.blob}, this.cache.getBlobFileCount());
        } finally {
          release();
        }
      }
    );
  }

  async delete(slot: Slot, rootHex: RootHex): Promise<void> {
    await observeFlatFileStoreOperation(
      this.metrics,
      FlatFileStoreType.blob,
      FlatFileStoreOperation.delete,
      async () => {
        const release = await this.acquireLock(slot, rootHex);
        try {
          await fs.promises.rm(this.filePath(slot, rootHex), {force: true});
          this.cache.removeBlobPresent(slot, rootHex);
          this.metrics?.files.set({store: FlatFileStoreType.blob}, this.cache.getBlobFileCount());
        } finally {
          release();
        }
      }
    );
  }

  has(slot: Slot, rootHex: RootHex): boolean {
    return this.cache.hasBlobPresent(slot, rootHex);
  }

  /**
   * Delete all slot directories with slot < minSlot.
   */
  async pruneBeforeSlot(minSlot: Slot): Promise<void> {
    await observeFlatFileStoreOperation(
      this.metrics,
      FlatFileStoreType.blob,
      FlatFileStoreOperation.prune,
      async () => {
        for (const slot of this.cache.getBlobSlotsBefore(minSlot)) {
          await fs.promises.rm(path.join(this.dir, padSlot(slot)), {recursive: true, force: true});
          this.cache.removeBlobSlot(slot);
          this.metrics?.prunedDirectories.inc({store: FlatFileStoreType.blob});
          this.metrics?.files.set({store: FlatFileStoreType.blob}, this.cache.getBlobFileCount());
        }
      }
    );
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

    return observeFlatFileStoreOperation(
      this.metrics,
      FlatFileStoreType.blob,
      FlatFileStoreOperation.read,
      async () => {
        const slotDir = path.join(this.dir, padSlot(slot));
        try {
          const files = await fs.promises.readdir(slotDir);
          const blobFiles = files.filter((file) => file.endsWith(".ssz") && file.startsWith("0x"));
          if (blobFiles.length === 1) return this.readPath(path.join(slotDir, blobFiles[0]));
        } catch (e) {
          if (!isFsNotFoundError(e)) throw e;
        }
        return null;
      }
    );
  }
}
