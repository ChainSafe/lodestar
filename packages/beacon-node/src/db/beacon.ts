import {ChainForkConfig} from "@lodestar/config";
import {Db, LevelDbControllerMetrics} from "@lodestar/db";
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
}
