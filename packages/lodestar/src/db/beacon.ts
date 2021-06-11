/**
 * @module db/api/beacon
 */

import {allForks} from "@chainsafe/lodestar-types";
import {DatabaseService, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {IBeaconDb} from "./interface";
import {
  AggregateAndProofRepository,
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
} from "./repositories";
import {
  PreGenesisState,
  PreGenesisStateLastProcessedBlock,
  LatestFinalizedUpdate,
  LatestNonFinalizedUpdate,
} from "./single";
import {SeenAttestationCache} from "./seenAttestationCache";
import {PendingBlockRepository} from "./repositories/pendingBlock";
import {AttestationPool} from "./attestationPool";
import {SyncCommitteeCache} from "./syncCommittee";
import {SyncCommitteeContributionCache} from "./syncCommitteeContribution";

export class BeaconDb extends DatabaseService implements IBeaconDb {
  block: BlockRepository;
  pendingBlock: PendingBlockRepository;
  seenAttestationCache: SeenAttestationCache;
  attestationPool: AttestationPool;
  blockArchive: BlockArchiveRepository;
  stateArchive: StateArchiveRepository;

  aggregateAndProof: AggregateAndProofRepository;
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositEvent: DepositEventRepository;

  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;
  preGenesisState: PreGenesisState;
  preGenesisStateLastProcessedBlock: PreGenesisStateLastProcessedBlock;

  // altair
  syncCommittee: SyncCommitteeCache;
  syncCommitteeContribution: SyncCommitteeContributionCache;
  bestUpdatePerCommitteePeriod: BestUpdatePerCommitteePeriod;
  latestFinalizedUpdate: LatestFinalizedUpdate;
  latestNonFinalizedUpdate: LatestNonFinalizedUpdate;
  lightclientFinalizedCheckpoint: LightclientFinalizedCheckpoint;

  constructor(opts: IDatabaseApiOptions) {
    super(opts);
    // Warning: If code is ever run in the constructor, must change this stub to not extend 'packages/lodestar/test/utils/stub/beaconDb.ts' -
    this.block = new BlockRepository(this.config, this.db);
    this.pendingBlock = new PendingBlockRepository(this.config, this.db);
    this.seenAttestationCache = new SeenAttestationCache(this.config, 2048);
    this.attestationPool = new AttestationPool();
    this.blockArchive = new BlockArchiveRepository(this.config, this.db);
    this.stateArchive = new StateArchiveRepository(this.config, this.db);
    this.aggregateAndProof = new AggregateAndProofRepository(this.config, this.db);
    this.voluntaryExit = new VoluntaryExitRepository(this.config, this.db);
    this.proposerSlashing = new ProposerSlashingRepository(this.config, this.db);
    this.attesterSlashing = new AttesterSlashingRepository(this.config, this.db);
    this.depositEvent = new DepositEventRepository(this.config, this.db);
    this.depositDataRoot = new DepositDataRootRepository(this.config, this.db);
    this.eth1Data = new Eth1DataRepository(this.config, this.db);
    this.preGenesisState = new PreGenesisState(this.config, this.db);
    this.preGenesisStateLastProcessedBlock = new PreGenesisStateLastProcessedBlock(this.config, this.db);
    // altair
    this.syncCommittee = new SyncCommitteeCache(this.config);
    this.syncCommitteeContribution = new SyncCommitteeContributionCache(this.config);
    this.bestUpdatePerCommitteePeriod = new BestUpdatePerCommitteePeriod(this.config, this.db);
    this.latestFinalizedUpdate = new LatestFinalizedUpdate(this.config, this.db);
    this.latestNonFinalizedUpdate = new LatestNonFinalizedUpdate(this.config, this.db);
    this.lightclientFinalizedCheckpoint = new LightclientFinalizedCheckpoint(this.config, this.db);
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
      this.aggregateAndProof.removeIncluded(signedBlock.message.body.attestations),
    ]);
  }

  async stop(): Promise<void> {
    await super.stop();
  }
}
