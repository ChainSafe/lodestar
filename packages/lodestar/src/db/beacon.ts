/**
 * @module db/api/beacon
 */

import {DatabaseService, IDatabaseApiOptions, IDbMetrics} from "@chainsafe/lodestar-db";
import {IBeaconDb} from "./interface";
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
  BestPartialLightClientUpdateRepository,
  CheckpointHeaderRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  BackfilledRanges,
} from "./repositories";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "./single";

export class BeaconDb extends DatabaseService implements IBeaconDb {
  metrics?: IDbMetrics;

  block: BlockRepository;
  blockArchive: BlockArchiveRepository;
  stateArchive: StateArchiveRepository;

  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositEvent: DepositEventRepository;

  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;
  preGenesisState: PreGenesisState;
  preGenesisStateLastProcessedBlock: PreGenesisStateLastProcessedBlock;

  // lightclient
  bestPartialLightClientUpdate: BestPartialLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  backfilledRanges: BackfilledRanges;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.metrics = opts.metrics;
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/lodestar/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(this.config, this.db, this.metrics);
    this.blockArchive = new BlockArchiveRepository(this.config, this.db, this.metrics);
    this.stateArchive = new StateArchiveRepository(this.config, this.db, this.metrics);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db, this.metrics);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db, this.metrics);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db, this.metrics);
    this.depositEvent = new DepositEventRepository(this.config, this.db, this.metrics);
    this.depositDataRoot = new DepositDataRootRepository(this.config, this.db, this.metrics);
    this.eth1Data = new Eth1DataRepository(this.config, this.db, this.metrics);
    this.preGenesisState = new PreGenesisState(this.config, this.db, this.metrics);
    this.preGenesisStateLastProcessedBlock = new PreGenesisStateLastProcessedBlock(this.config, this.db, this.metrics);

    // lightclient
    this.bestPartialLightClientUpdate = new BestPartialLightClientUpdateRepository(this.config, this.db, this.metrics);
    this.checkpointHeader = new CheckpointHeaderRepository(this.config, this.db, this.metrics);
    this.syncCommittee = new SyncCommitteeRepository(this.config, this.db, this.metrics);
    this.syncCommitteeWitness = new SyncCommitteeWitnessRepository(this.config, this.db, this.metrics);

    this.backfilledRanges = new BackfilledRanges(this.config, this.db, this.metrics);
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}
