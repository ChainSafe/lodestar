import {DatabaseService, DatabaseApiOptions} from "@lodestar/db";
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
  BlobsSidecarRepository,
  BlobsSidecarArchiveRepository,
  BLSToExecutionChangeRepository,
} from "./repositories/index.js";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "./single/index.js";

export class BeaconDb extends DatabaseService implements IBeaconDb {
  block: BlockRepository;
  blobsSidecar: BlobsSidecarRepository;
  blockArchive: BlockArchiveRepository;
  blobsSidecarArchive: BlobsSidecarArchiveRepository;
  stateArchive: StateArchiveRepository;

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

  constructor(opts: DatabaseApiOptions) {
    super(opts);

    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/beacon-node/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(this.config, this.db);
    this.blobsSidecar = new BlobsSidecarRepository(this.config, this.db);
    this.blockArchive = new BlockArchiveRepository(this.config, this.db);
    this.blobsSidecarArchive = new BlobsSidecarArchiveRepository(this.config, this.db);
    this.stateArchive = new StateArchiveRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.blsToExecutionChange = new BLSToExecutionChangeRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.depositEvent = new DepositEventRepository(this.config, this.db);
    this.depositDataRoot = new DepositDataRootRepository(this.config, this.db);
    this.eth1Data = new Eth1DataRepository(this.config, this.db);
    this.preGenesisState = new PreGenesisState(this.config, this.db);
    this.preGenesisStateLastProcessedBlock = new PreGenesisStateLastProcessedBlock(this.config, this.db);

    // lightclient
    this.bestLightClientUpdate = new BestLightClientUpdateRepository(this.config, this.db);
    this.checkpointHeader = new CheckpointHeaderRepository(this.config, this.db);
    this.syncCommittee = new SyncCommitteeRepository(this.config, this.db);
    this.syncCommitteeWitness = new SyncCommitteeWitnessRepository(this.config, this.db);

    this.backfilledRanges = new BackfilledRanges(this.config, this.db);
  }

  async stop(): Promise<void> {
    await super.stop();
  }

  async pruneHotDb(): Promise<void> {
    // Prune all hot blobs
    await this.blobsSidecar.batchDelete(await this.blobsSidecar.keys());
    // Prune all hot blocks
    // TODO: Enable once it's deemed safe
    // await this.block.batchDelete(await this.block.keys());
  }
}
