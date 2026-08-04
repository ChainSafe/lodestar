import {ChainForkConfig} from "@lodestar/config";
import {Db, LevelDbControllerMetrics, encodeKey} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {Bucket} from "./buckets.js";
import {FlatFileStore} from "./flatFileStore/flatFileStore.js";
import type {IFlatFileStore} from "./flatFileStore/interface.js";
import type {FlatFileStoreMetrics} from "./flatFileStore/metrics.js";
import {migrateArchivedSidecars} from "./flatFileStore/migrate.js";
import {IBeaconDb} from "./interface.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BackfilledRanges,
  BestLightClientUpdateRepository,
  BlobSidecarsArchiveRepository,
  BlockArchiveRepository,
  BlockRepository,
  CheckpointHeaderRepository,
  DataColumnSidecarArchiveRepository,
  ExecutionPayloadEnvelopeArchiveRepository,
  ExecutionPayloadEnvelopeRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  VoluntaryExitRepository,
} from "./repositories/index.js";

export type BeaconDbModules = {
  config: ChainForkConfig;
  db: Db;
};

export class BeaconDb implements IBeaconDb {
  block: BlockRepository;
  blockArchive: BlockArchiveRepository;

  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;

  stateArchive: StateArchiveRepository;
  checkpointState: CheckpointStateRepository;

  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;

  // lightclient
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  backfilledRanges: BackfilledRanges;

  private flatFileStoreInstance: IFlatFileStore | null = null;
  private readonly legacyBlobSidecarsArchive: BlobSidecarsArchiveRepository;
  private readonly legacyDataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  constructor(
    private readonly config: ChainForkConfig,
    protected readonly db: Db
  ) {
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/beacon-node/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(config, db);
    this.blockArchive = new BlockArchiveRepository(config, db);

    this.legacyBlobSidecarsArchive = new BlobSidecarsArchiveRepository(config, db);
    this.legacyDataColumnSidecarArchive = new DataColumnSidecarArchiveRepository(config, db);

    this.executionPayloadEnvelope = new ExecutionPayloadEnvelopeRepository(config, db);
    this.executionPayloadEnvelopeArchive = new ExecutionPayloadEnvelopeArchiveRepository(config, db);

    this.stateArchive = new StateArchiveRepository(config, db);
    this.checkpointState = new CheckpointStateRepository(config, db);
    this.voluntaryExit = new VoluntaryExitRepository(config, db);
    this.blsToExecutionChange = new BLSToExecutionChangeRepository(config, db);
    this.proposerSlashing = new ProposerSlashingRepository(config, db);
    this.attesterSlashing = new AttesterSlashingRepository(config, db);

    // lightclient
    this.bestLightClientUpdate = new BestLightClientUpdateRepository(config, db);
    this.checkpointHeader = new CheckpointHeaderRepository(config, db);
    this.syncCommittee = new SyncCommitteeRepository(config, db);
    this.syncCommitteeWitness = new SyncCommitteeWitnessRepository(config, db);

    this.backfilledRanges = new BackfilledRanges(config, db);
  }

  async initFlatFileStore(
    dataDir: string,
    finalizedCheckpointSlot: Slot,
    logger: Logger,
    metrics: FlatFileStoreMetrics | null
  ): Promise<void> {
    const store = new FlatFileStore(dataDir, this.config, logger, metrics);
    await store.init(finalizedCheckpointSlot);
    await migrateArchivedSidecars(
      this.config,
      this.legacyBlobSidecarsArchive,
      this.legacyDataColumnSidecarArchive,
      store,
      this.db,
      logger,
      metrics
    );
    this.flatFileStoreInstance = store;
  }

  get flatFileStore(): IFlatFileStore {
    if (!this.flatFileStoreInstance) {
      throw new Error("Flat file store is not initialized");
    }
    return this.flatFileStoreInstance;
  }

  async close(): Promise<void> {
    await this.flatFileStoreInstance?.close();
    return this.db.close();
  }

  setMetrics(metrics: LevelDbControllerMetrics): void {
    this.db.setMetrics(metrics);
  }

  async pruneHotDb(): Promise<void> {
    await Promise.all([
      this.deleteBucketData(Bucket.deneb_blobSidecars),
      this.deleteBucketData(Bucket.allForks_dataColumnSidecars),
    ]);
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
