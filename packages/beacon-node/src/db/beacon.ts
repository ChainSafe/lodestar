import {Db, LevelDbControllerMetrics} from "@lodestar/db";
import {ChainForkConfig} from "@lodestar/config";
import {IBeaconDb} from "./interface.js";
import {
  AttesterSlashingRepository,
  BlockArchiveRepository,
  BlockRepository,
  DepositEventRepository,
  DepositDataRootRepository,
  Eth1DataRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  VoluntaryExitRepository,
  BestLightClientUpdateRepository,
  CheckpointHeaderRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  BackfilledRanges,
  BlobSidecarsRepository,
  BlobSidecarsArchiveRepository,
  BLSToExecutionChangeRepository,
} from "./repositories/index.js";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "./single/index.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";

export type BeaconDbModules = {
  config: ChainForkConfig;
  db: Db;
};

export class BeaconDb implements IBeaconDb {
  block: BlockRepository;
  blockArchive: BlockArchiveRepository;

  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;

  stateArchive: StateArchiveRepository;
  checkpointState: CheckpointStateRepository;

  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositEvent: DepositEventRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;

  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;
  preGenesisState: PreGenesisState;
  preGenesisStateLastProcessedBlock: PreGenesisStateLastProcessedBlock;

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

    this.stateArchive = new StateArchiveRepository(config, db);
    this.checkpointState = new CheckpointStateRepository(config, db);
    this.voluntaryExit = new VoluntaryExitRepository(config, db);
    this.blsToExecutionChange = new BLSToExecutionChangeRepository(config, db);
    this.proposerSlashing = new ProposerSlashingRepository(config, db);
    this.attesterSlashing = new AttesterSlashingRepository(config, db);
    this.depositEvent = new DepositEventRepository(config, db);
    this.depositDataRoot = new DepositDataRootRepository(config, db);
    this.eth1Data = new Eth1DataRepository(config, db);
    this.preGenesisState = new PreGenesisState(config, db);
    this.preGenesisStateLastProcessedBlock = new PreGenesisStateLastProcessedBlock(config, db);

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
