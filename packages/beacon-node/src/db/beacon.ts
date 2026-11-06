import {ChainForkConfig} from "@lodestar/config";
import {Db, LevelDbControllerMetrics, encodeKey} from "@lodestar/db";
import {Logger} from "@lodestar/utils";
import {Bucket} from "./buckets.js";
import {type IDataColumnStore, LegacyDataColumnStore} from "./dataColumnStore.js";
import {FlatFileStore} from "./flatFileStore/flatFileStore.js";
import type {FlatFileStoreMetrics} from "./flatFileStore/metrics.js";
import {IBeaconDb} from "./interface.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {EarliestAvailableSlotRepository} from "./repositories/earliestAvailableSlot.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BestLightClientUpdateRepository,
  BlobSidecarsArchiveRepository,
  BlobSidecarsRepository,
  BlockArchiveRepository,
  BlockRepository,
  CheckpointHeaderRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
  ExecutionPayloadEnvelopeArchiveRepository,
  ExecutionPayloadEnvelopeRepository,
  ProposerPreferencesRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  VoluntaryExitRepository,
} from "./repositories/index.js";

/** Below this size, seeks over leftover legacy column data stay cheap */
const LEGACY_DATA_COLUMNS_COMPACTION_MIN_BYTES = 1024 ** 3;

export type BeaconDbOpts = {
  dataColumnDir: string;
  logger: Logger;
  metrics?: FlatFileStoreMetrics | null;
};

export class BeaconDb implements IBeaconDb {
  block: BlockRepository;
  blockArchive: BlockArchiveRepository;

  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;

  stateArchive: StateArchiveRepository;
  checkpointState: CheckpointStateRepository;
  earliestAvailableSlot: EarliestAvailableSlotRepository;

  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  proposerPreferences: ProposerPreferencesRepository;
  attesterSlashing: AttesterSlashingRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;

  // lightclient
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  readonly dataColumns: IDataColumnStore;
  private readonly flatFileStore: FlatFileStore;
  private readonly logger: Logger;

  constructor(
    config: ChainForkConfig,
    protected readonly db: Db,
    opts: BeaconDbOpts
  ) {
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/beacon-node/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(config, db);
    this.blockArchive = new BlockArchiveRepository(config, db);

    this.blobSidecars = new BlobSidecarsRepository(config, db);
    this.blobSidecarsArchive = new BlobSidecarsArchiveRepository(config, db);
    this.dataColumnSidecar = new DataColumnSidecarRepository(config, db);
    this.dataColumnSidecarArchive = new DataColumnSidecarArchiveRepository(config, db);

    this.executionPayloadEnvelope = new ExecutionPayloadEnvelopeRepository(config, db);
    this.executionPayloadEnvelopeArchive = new ExecutionPayloadEnvelopeArchiveRepository(config, db);

    this.stateArchive = new StateArchiveRepository(config, db);
    this.checkpointState = new CheckpointStateRepository(config, db);
    this.earliestAvailableSlot = new EarliestAvailableSlotRepository(db);
    this.voluntaryExit = new VoluntaryExitRepository(config, db);
    this.blsToExecutionChange = new BLSToExecutionChangeRepository(config, db);
    this.proposerSlashing = new ProposerSlashingRepository(config, db);
    this.proposerPreferences = new ProposerPreferencesRepository(config, db);
    this.attesterSlashing = new AttesterSlashingRepository(config, db);

    // lightclient
    this.bestLightClientUpdate = new BestLightClientUpdateRepository(config, db);
    this.checkpointHeader = new CheckpointHeaderRepository(config, db);
    this.syncCommittee = new SyncCommitteeRepository(config, db);
    this.syncCommitteeWitness = new SyncCommitteeWitnessRepository(config, db);

    this.logger = opts.logger;
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
  }

  async close(): Promise<void> {
    await this.flatFileStore.close();
    return this.db.close();
  }

  setMetrics(metrics: LevelDbControllerMetrics, flatFileStoreMetrics: FlatFileStoreMetrics | null = null): void {
    this.db.setMetrics(metrics);
    this.flatFileStore.setMetrics(flatFileStoreMetrics);
  }

  /**
   * Deletes made while an iterator held a snapshot can stay in the bottom LevelDB level, which `compactRange` never
   * rewrites, so every seek into the legacy column buckets walks them. Writing a key at each end of the pruned range
   * makes the compaction overlap those files and rewrite them.
   */
  async compactLegacyDataColumns(
    prunedBeforeSlot: Slot,
    minSizeBytes = LEGACY_DATA_COLUMNS_COMPACTION_MIN_BYTES
  ): Promise<void> {
    const archiveBucket = Bucket.allForks_dataColumnSidecarsArchive;
    const start = encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(0));
    const end = encodeKey(archiveBucket, this.dataColumnSidecarArchive.getMinKeyRaw(prunedBeforeSlot));
    const sizeBytes = await this.db.approximateSize(start, end);
    if (sizeBytes < minSizeBytes) return;

    // Column indices stay below 0xffff and hot column keys are shorter, so no sentinel matches a real key
    const upperSentinel =
      prunedBeforeSlot > 0
        ? encodeKey(archiveBucket, this.dataColumnSidecarArchive.encodeKeyRaw(prunedBeforeSlot - 1, 0xffff))
        : encodeKey(Bucket.allForks_dataColumnSidecars, Buffer.alloc(35, 0xff));
    const sentinels = [start, upperSentinel];

    this.logger.info("Compacting legacy data columns, this may take a while", {sizeBytes});
    const startTime = Date.now();
    await this.db.batchPut(sentinels.map((key) => ({key, value: new Uint8Array()})));
    await this.db.compactRange(start, end);
    await this.db.batchDelete(sentinels);
    await this.db.compactRange(start, end);
    this.logger.verbose("Compacted legacy data columns", {
      durationMs: Date.now() - startTime,
      sizeBytes: await this.db.approximateSize(start, end),
    });
  }

  async pruneHotDb(): Promise<void> {
    // Prune all hot blobs
    await this.blobSidecars.batchDelete(await this.blobSidecars.keys());
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
