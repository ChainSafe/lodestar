import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {ColumnStore} from "./columnStore.js";
import {DataColumnStoreError, DataColumnStoreErrorCode} from "./errors.js";
import type {IFlatFileStore} from "./interface.js";
import type {FlatFileStoreMetrics} from "./metrics.js";
import {SlotIndex} from "./slotIndex.js";

/**
 * Filesystem storage for data columns, keyed by slot and block root.
 * Hot and finalized data share the same layout. The top-level slot index is rebuilt on startup
 * without inspecting the contents of slot directories.
 */
export class FlatFileStore implements IFlatFileStore {
  private readonly slotIndex: SlotIndex;
  private readonly columnStore: ColumnStore;

  constructor(
    dataDir: string,
    config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly metrics: FlatFileStoreMetrics | null = null
  ) {
    this.slotIndex = new SlotIndex();
    this.columnStore = new ColumnStore(dataDir, config, this.slotIndex, metrics);
  }

  async init(): Promise<void> {
    const endTimer = this.metrics?.startupDuration.startTimer();
    try {
      await fs.promises.mkdir(this.columnStore.dir, {recursive: true});
      const stats = await this.slotIndex.rebuildFromDisk(this.columnStore.dir);
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

  async deleteMany(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void> {
    const results = await Promise.allSettled(
      items.map(({slot, blockRoot}) => this.columnStore.delete(slot, blockRoot))
    );
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

  async pruneBefore(slot: Slot): Promise<void> {
    await this.columnStore.pruneBeforeSlot(slot);
  }
}
