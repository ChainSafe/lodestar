import fs from "node:fs";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostFulu} from "@lodestar/params";
import {DataColumnSidecar, RootHex, Slot} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import type {BlobSidecarsWrapper} from "../repositories/blobSidecars.js";
import {blobSidecarsWrapperSsz} from "../repositories/blobSidecars.js";
import {cleanupPartFiles} from "./atomicWrite.js";
import {BlobStore} from "./blobStore.js";
import {ColumnStore} from "./columnStore.js";
import {ExistenceCache} from "./existenceCache.js";
import type {IFlatFileStore} from "./interface.js";
import {removeSlotDirectories} from "./slotDirectory.js";

export class FlatFileStore implements IFlatFileStore {
  private readonly cache: ExistenceCache;
  private readonly blobStore: BlobStore;
  private readonly columnStore: ColumnStore;

  constructor(
    dataDir: string,
    private readonly config: ChainForkConfig,
    private readonly logger: Logger
  ) {
    this.cache = new ExistenceCache();
    this.blobStore = new BlobStore(dataDir, this.cache);
    this.columnStore = new ColumnStore(dataDir, config, this.cache);
  }

  async init(finalizedCheckpointSlot: Slot): Promise<void> {
    // Ensure directories exist
    await fs.promises.mkdir(this.blobStore.dir, {recursive: true});
    await fs.promises.mkdir(this.columnStore.dir, {recursive: true});

    // Hot data is refetched after restart. Remove it before rebuilding the cache so roots
    // from the previous unfinalized fork cannot survive canonical cleanup.
    const [hotBlobSlots, hotColumnSlots] = await Promise.all([
      removeSlotDirectories(this.blobStore.dir, (slot) => slot > finalizedCheckpointSlot),
      removeSlotDirectories(this.columnStore.dir, (slot) => slot > finalizedCheckpointSlot),
    ]);
    if (hotBlobSlots > 0 || hotColumnSlots > 0) {
      this.logger.info("Removed hot flat file data", {
        finalizedCheckpointSlot,
        blobSlots: hotBlobSlots,
        columnSlots: hotColumnSlots,
      });
    }

    // Clean up partial writes from previous crashes
    const blobsCleaned = await cleanupPartFiles(this.blobStore.dir);
    const colsCleaned = await cleanupPartFiles(this.columnStore.dir);
    if (blobsCleaned > 0 || colsCleaned > 0) {
      this.logger.info("Cleaned up partial flat file writes", {blobs: blobsCleaned, columns: colsCleaned});
    }

    // Rebuild existence cache from disk
    const stats = await this.cache.rebuildFromDisk(this.blobStore.dir, this.columnStore.dir);
    this.logger.info("Flat file store initialized", {
      blobFiles: stats.blobFiles,
      columnFiles: stats.columnFiles,
    });
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

  async deleteBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<void> {
    await this.blobStore.delete(slot, blockRoot);
  }

  hasBlobSidecars(slot: Slot, blockRoot: RootHex): boolean {
    return this.blobStore.has(slot, blockRoot);
  }

  async *blobSidecarsBinaryEntriesStream(opts: {gte: Slot; lt: Slot}): AsyncIterable<{slot: Slot; data: Uint8Array}> {
    yield* this.blobStore.streamBinaryEntries(opts.gte, opts.lt);
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

  async putDataColumns(slot: Slot, blockRoot: RootHex, columns: DataColumnSidecar[]): Promise<void> {
    const dataColumnSidecarType = this.config.getForkTypes<ForkPostFulu>(slot).DataColumnSidecar;
    const binaryColumns = columns.map((col) => ({
      index: col.index,
      data: dataColumnSidecarType.serialize(col),
    }));
    await this.columnStore.putColumnsBinary(slot, blockRoot, fromHex(blockRoot), binaryColumns);
  }

  async deleteDataColumns(slot: Slot, blockRoot: RootHex): Promise<void> {
    await this.columnStore.delete(slot, blockRoot);
  }

  async getDataColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]> {
    return this.columnStore.getColumnsBinaryBySlot(slot, indices);
  }

  // --- Pruning ---

  async deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void> {
    await Promise.all(
      items.map(async ({slot, blockRoot}) => {
        await this.blobStore.delete(slot, blockRoot);
        await this.columnStore.delete(slot, blockRoot);
      })
    );
  }

  async pruneBlobsBeforeSlot(slot: Slot): Promise<void> {
    await this.blobStore.pruneBeforeSlot(slot);
  }

  async pruneColumnsBeforeSlot(slot: Slot): Promise<void> {
    await this.columnStore.pruneBeforeSlot(slot);
  }
}
