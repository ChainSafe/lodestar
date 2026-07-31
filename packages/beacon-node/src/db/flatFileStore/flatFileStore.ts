import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import type {BlobSidecarsWrapper} from "../repositories/blobSidecars.js";
import {blobSidecarsWrapperSsz} from "../repositories/blobSidecars.js";
import {BlobStore} from "./blobStore.js";
import {ColumnStore} from "./columnStore.js";
import {ExistenceCache} from "./existenceCache.js";
import type {IFlatFileStore} from "./interface.js";
import {type FlatFileStoreMetrics, FlatFileStoreType} from "./metrics.js";
import {removeSlotDirectories} from "./slotDirectory.js";

export class FlatFileStore implements IFlatFileStore {
  private readonly cache: ExistenceCache;
  private readonly blobStore: BlobStore;
  private readonly columnStore: ColumnStore;

  constructor(
    dataDir: string,
    config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly metrics: FlatFileStoreMetrics | null = null
  ) {
    this.cache = new ExistenceCache();
    this.blobStore = new BlobStore(dataDir, this.cache, metrics);
    this.columnStore = new ColumnStore(dataDir, config, this.cache, metrics);
  }

  async init(finalizedCheckpointSlot: Slot): Promise<void> {
    const endTimer = this.metrics?.startupDuration.startTimer();
    try {
      // Ensure directories exist
      await fs.promises.mkdir(this.blobStore.dir, {recursive: true});
      await fs.promises.mkdir(this.columnStore.dir, {recursive: true});

      // Hot data is refetched after restart. Remove it before rebuilding the cache so roots
      // from the previous unfinalized fork cannot survive canonical cleanup.
      const [hotBlobSlots, hotColumnSlots] = await Promise.all([
        removeSlotDirectories(this.blobStore.dir, (slot) => slot > finalizedCheckpointSlot),
        removeSlotDirectories(this.columnStore.dir, (slot) => slot > finalizedCheckpointSlot),
      ]);
      this.metrics?.prunedDirectories.inc({store: FlatFileStoreType.blob}, hotBlobSlots);
      this.metrics?.prunedDirectories.inc({store: FlatFileStoreType.column}, hotColumnSlots);
      if (hotBlobSlots > 0 || hotColumnSlots > 0) {
        this.logger.info("Removed hot flat file data", {
          finalizedCheckpointSlot,
          blobSlots: hotBlobSlots,
          columnSlots: hotColumnSlots,
        });
      }

      // Rebuild existence cache from disk
      const stats = await this.cache.rebuildFromDisk(this.blobStore.dir, this.columnStore.dir);
      this.metrics?.files.set({store: FlatFileStoreType.blob}, this.cache.getBlobFileCount());
      this.metrics?.files.set({store: FlatFileStoreType.column}, this.cache.getColumnFileCount());
      if (stats.ignoredBlobEntries > 0 || stats.ignoredColumnEntries > 0) {
        this.logger.warn("Ignored non-canonical flat file store entries", {
          blobEntries: stats.ignoredBlobEntries,
          columnEntries: stats.ignoredColumnEntries,
        });
      }
      this.logger.info("Flat file store initialized", {
        blobFiles: stats.blobFiles,
        columnFiles: stats.columnFiles,
      });
    } catch (e) {
      this.metrics?.startupErrors.inc();
      throw e;
    } finally {
      endTimer?.();
    }
  }

  async close(): Promise<void> {
    // Nothing to close — all operations are stateless file I/O
  }

  // --- Blobs ---

  async getBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<BlobSidecarsWrapper | null> {
    const data = await this.blobStore.getBinary(slot, blockRoot);
    if (!data) return null;
    return blobSidecarsWrapperSsz.deserialize(data);
  }

  async getBlobSidecarsBinary(slot: Slot, blockRoot: RootHex): Promise<Uint8Array | null> {
    return this.blobStore.getBinary(slot, blockRoot);
  }

  async getBlobSidecarsBinaryBySlot(slot: Slot): Promise<Uint8Array | null> {
    return this.blobStore.getBinaryBySlot(slot);
  }

  async putBlobSidecars(slot: Slot, blockRoot: RootHex, data: Uint8Array): Promise<void> {
    await this.blobStore.put(slot, blockRoot, data);
  }

  // --- Columns ---

  async getDataColumns(slot: Slot, blockRoot: RootHex): Promise<DataColumnSidecar[]> {
    return this.columnStore.getColumns(slot, blockRoot);
  }

  async getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    return this.columnStore.getColumnsBinary(slot, blockRoot, indices);
  }

  async putDataColumnsBinary(
    slot: Slot,
    blockRoot: RootHex,
    columns: {index: number; data: Uint8Array}[]
  ): Promise<void> {
    await this.columnStore.putColumnsBinary(slot, blockRoot, fromHex(blockRoot), columns);
  }

  async getDataColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    return this.columnStore.getColumnsBinaryBySlot(slot, indices);
  }

  // --- Pruning ---

  async deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void> {
    const results = await Promise.allSettled(
      items.flatMap(({slot, blockRoot}) => [
        this.blobStore.delete(slot, blockRoot),
        this.columnStore.delete(slot, blockRoot),
      ])
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to delete non-canonical flat file data");
    }
  }

  async pruneBlobsBeforeSlot(slot: Slot): Promise<void> {
    await this.blobStore.pruneBeforeSlot(slot);
  }

  async pruneColumnsBeforeSlot(slot: Slot): Promise<void> {
    await this.columnStore.pruneBeforeSlot(slot);
  }
}
