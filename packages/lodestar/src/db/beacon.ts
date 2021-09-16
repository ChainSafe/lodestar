/**
 * @module db/api/beacon
 */

import {allForks} from "@chainsafe/lodestar-types";
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
  BestUpdatePerCommitteePeriod,
  LightclientFinalizedCheckpoint,
  LightClientInitProofRepository,
  LightClientSyncCommitteeProofRepository,
} from "./repositories";
import {
  PreGenesisState,
  PreGenesisStateLastProcessedBlock,
  LatestFinalizedUpdate,
  LatestNonFinalizedUpdate,
  TotalTerminalDifficulty,
} from "./single";
import {PendingBlockRepository} from "./repositories/pendingBlock";

export class BeaconDb extends DatabaseService implements IBeaconDb {
  metrics?: IDbMetrics;

  block: BlockRepository;
  pendingBlock: PendingBlockRepository;
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

  // altair
  bestUpdatePerCommitteePeriod: BestUpdatePerCommitteePeriod;
  latestFinalizedUpdate: LatestFinalizedUpdate;
  latestNonFinalizedUpdate: LatestNonFinalizedUpdate;
  lightclientFinalizedCheckpoint: LightclientFinalizedCheckpoint;
  lightClientInitProof: LightClientInitProofRepository;
  lightClientSyncCommitteeProof: LightClientSyncCommitteeProofRepository;
  totalTerminalDifficulty: TotalTerminalDifficulty;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    this.metrics = opts.metrics;
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/lodestar/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(this.config, this.db, this.metrics);
    this.pendingBlock = new PendingBlockRepository(this.config, this.db, this.metrics);
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
    // altair
    this.bestUpdatePerCommitteePeriod = new BestUpdatePerCommitteePeriod(this.config, this.db, this.metrics);
    this.latestFinalizedUpdate = new LatestFinalizedUpdate(this.config, this.db, this.metrics);
    this.latestNonFinalizedUpdate = new LatestNonFinalizedUpdate(this.config, this.db, this.metrics);
    this.lightclientFinalizedCheckpoint = new LightclientFinalizedCheckpoint(this.config, this.db, this.metrics);
    this.lightClientInitProof = new LightClientInitProofRepository(this.config, this.db, this.metrics);
    this.lightClientSyncCommitteeProof = new LightClientSyncCommitteeProofRepository(
      this.config,
      this.db,
      this.metrics
    );
    // merge
    this.totalTerminalDifficulty = new TotalTerminalDifficulty(this.config, this.db, this.metrics);
  }

  /**
   * Remove stored operations based on a newly processed block
   */
  async processBlockOperations(signedBlock: allForks.SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.voluntaryExit.batchRemove(signedBlock.message.body.voluntaryExits),
      this.depositEvent.deleteOld(signedBlock.message.body.eth1Data.depositCount),
      this.proposerSlashing.batchRemove(signedBlock.message.body.proposerSlashings),
      this.attesterSlashing.batchRemove(signedBlock.message.body.attesterSlashings),
    ]);
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}
