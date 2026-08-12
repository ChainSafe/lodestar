import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {ColumnStore} from "./columnStore.js";
import {ExistenceCache} from "./existenceCache.js";
import type {IFlatFileStore} from "./interface.js";
import type {FlatFileStoreMetrics} from "./metrics.js";
import {removeSlotDirectories} from "./slotDirectory.js";

/**
 * Filesystem storage for data columns, keyed by slot and block root.
 * Hot and finalized data share the same layout. On startup, unfinalized directories are
 * removed and the in-memory existence cache is rebuilt from the remaining files.
 */
export class FlatFileStore implements IFlatFileStore {
  private readonly cache: ExistenceCache;
  private readonly columnStore: ColumnStore;

  constructor(
    dataDir: string,
    config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly metrics: FlatFileStoreMetrics | null = null
  ) {
    this.cache = new ExistenceCache();
    this.columnStore = new ColumnStore(dataDir, config, this.cache, metrics);
  }

  async init(finalizedBlockSlot: Slot): Promise<void> {
    const endTimer = this.metrics?.startupDuration.startTimer();
    try {
      // Ensure directories exist
      await fs.promises.mkdir(this.columnStore.dir, {recursive: true});

      // Hot data is refetched after restart. Remove it before rebuilding the cache so roots
      // from the previous unfinalized fork cannot survive canonical cleanup.
      const hotColumnSlots = await removeSlotDirectories(this.columnStore.dir, (slot) => slot > finalizedBlockSlot);
      this.metrics?.prunedDirectories.inc(hotColumnSlots);
      if (hotColumnSlots > 0) {
        this.logger.info("Removed hot flat file data", {
          finalizedBlockSlot,
          columnSlots: hotColumnSlots,
        });
      }

      // Rebuild existence cache from disk
      const stats = await this.cache.rebuildFromDisk(this.columnStore.dir);
      this.metrics?.files.set(this.cache.getColumnFileCount());
      if (stats.ignoredColumnEntries > 0) {
        this.logger.warn("Ignored non-canonical flat file store entries", {
          columnEntries: stats.ignoredColumnEntries,
        });
      }
      this.logger.info("Flat file store initialized", {
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
    // All operations are stateless file I/O.
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

  // --- Pruning ---

  async deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void> {
    const results = await Promise.allSettled(
      items.map(({slot, blockRoot}) => this.columnStore.delete(slot, blockRoot))
    );
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to delete non-canonical flat file data");
    }
  }

  async pruneColumnsBeforeSlot(slot: Slot): Promise<void> {
    await this.columnStore.pruneBeforeSlot(slot);
  }
}
