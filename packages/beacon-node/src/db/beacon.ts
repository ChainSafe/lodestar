import {ChainForkConfig} from "@lodestar/config";
import {Db, LevelDbControllerMetrics, encodeKey} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BeaconEngineDb} from "./beaconEngine.js";
import {Bucket} from "./buckets.js";
import {type IDataColumnStore, LegacyDataColumnStore} from "./dataColumnStore.js";
import {FlatFileStore} from "./flatFileStore/flatFileStore.js";
import type {FlatFileStoreMetrics} from "./flatFileStore/metrics.js";
import {IBeaconDb} from "./interface.js";
import {
  BlobSidecarsArchiveRepository,
  BlobSidecarsRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
} from "./repositories/index.js";

export type BeaconDbOpts = {
  dataColumnDir: string;
  logger: Logger;
  metrics?: FlatFileStoreMetrics | null;
};

export class BeaconDb extends BeaconEngineDb implements IBeaconDb {
  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  readonly dataColumns: IDataColumnStore;
  lastLegacyArchiveSlot: Slot | null = null;
  private readonly flatFileStore: FlatFileStore;

  constructor(config: ChainForkConfig, db: Db, opts: BeaconDbOpts) {
    super(config, db);
    this.blobSidecars = new BlobSidecarsRepository(config, db);
    this.blobSidecarsArchive = new BlobSidecarsArchiveRepository(config, db);
    this.dataColumnSidecar = new DataColumnSidecarRepository(config, db);
    this.dataColumnSidecarArchive = new DataColumnSidecarArchiveRepository(config, db);

    this.flatFileStore = new FlatFileStore(opts.dataColumnDir, config, opts.logger, opts.metrics);
    this.dataColumns = new LegacyDataColumnStore(
      this.flatFileStore,
      this.dataColumnSidecar,
      this.dataColumnSidecarArchive,
      this.blockArchive
    );
  }

  async init(): Promise<void> {
    await this.flatFileStore.init();
    const [lastLegacyKey] = await this.dataColumnSidecarArchive.keys({reverse: true, limit: 1});
    this.lastLegacyArchiveSlot = lastLegacyKey?.prefix ?? null;
  }

  async close(): Promise<void> {
    await this.flatFileStore.close();
    return this.db.close();
  }

  setMetrics(metrics: LevelDbControllerMetrics, flatFileStoreMetrics: FlatFileStoreMetrics | null = null): void {
    this.db.setMetrics(metrics);
    this.flatFileStore.setMetrics(flatFileStoreMetrics);
  }

  async pruneHotDb(): Promise<void> {
    // Prune all hot blobs
    await this.blobSidecars.batchDelete(await this.blobSidecars.keys());
    // New columns are persisted in flat files, so this bucket only contains legacy hot data.
    await this.deleteBucketData(Bucket.allForks_dataColumnSidecars);
    // Prune all hot blocks
    // TODO: Enable once it's deemed safe
    // await this.block.batchDelete(await this.block.keys());
  }

  async deleteDeprecatedEth1Data(): Promise<void> {
    const deprecatedBuckets = [
      Bucket.phase0_eth1Data,
      Bucket.index_depositDataRoot,
      Bucket.phase0_depositData,
      Bucket.phase0_depositEvent,
      Bucket.phase0_preGenesisState,
      Bucket.phase0_preGenesisStateLastProcessedBlock,
    ];

    for (const bucket of deprecatedBuckets) {
      await this.deleteBucketData(bucket);
    }
  }

  private async deleteBucketData(bucket: Bucket): Promise<void> {
    const minKey = encodeKey(bucket, Buffer.alloc(0));
    const maxKey = encodeKey(bucket + 1, Buffer.alloc(0));

    // Batch delete to avoid loading all keys into memory at once
    const BATCH_DELETE_SIZE = 1000;
    let keysBatch: Uint8Array[] = [];

    for await (const key of this.db.keysStream({gte: minKey, lt: maxKey})) {
      keysBatch.push(key);
      if (keysBatch.length >= BATCH_DELETE_SIZE) {
        await this.db.batchDelete(keysBatch);
        keysBatch = [];
      }
    }

    if (keysBatch.length > 0) {
      await this.db.batchDelete(keysBatch);
    }
  }
}
