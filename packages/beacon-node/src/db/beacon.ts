import {ChainForkConfig} from "@lodestar/config";
import {Db, LevelDbControllerMetrics, encodeKey} from "@lodestar/db";
import {Bucket} from "./buckets.js";
import {IBeaconDb} from "./interface.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BackfilledRanges,
  BestLightClientUpdateRepository,
  BlobSidecarsArchiveRepository,
  BlobSidecarsRepository,
  BlockArchiveRepository,
  BlockRepository,
  CheckpointHeaderRepository,
  DataColumnSidecarArchiveRepository,
  DataColumnSidecarRepository,
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

  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

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

  constructor(
    config: ChainForkConfig,
    protected readonly db: Db
  ) {
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/beacon-node/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(config, db);
    this.blockArchive = new BlockArchiveRepository(config, db);

    this.blobSidecars = new BlobSidecarsRepository(config, db);
    this.blobSidecarsArchive = new BlobSidecarsArchiveRepository(config, db);
    this.dataColumnSidecar = new DataColumnSidecarRepository(config, db);
    this.dataColumnSidecarArchive = new DataColumnSidecarArchiveRepository(config, db);

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

  close(): Promise<void> {
    return this.db.close();
  }

  setMetrics(metrics: LevelDbControllerMetrics): void {
    this.db.setMetrics(metrics);
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
