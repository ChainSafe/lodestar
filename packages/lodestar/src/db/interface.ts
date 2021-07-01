/**
 * @module db/api/beacon
 */

import {allForks} from "@chainsafe/lodestar-types";

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
import {PendingBlockRepository} from "./repositories/pendingBlock";
import {SyncCommitteeCache} from "./syncCommittee";
import {SyncCommitteeContributionCache} from "./syncCommitteeContribution";
import {IDbMetrics} from "../../../db/lib";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevent beacon chain objects
 */
export interface IBeaconDb {
  metrics?: IDbMetrics;

  // unfinalized blocks
  block: BlockRepository;

  // pending block
  pendingBlock: PendingBlockRepository;

  // finalized blocks
  blockArchive: BlockArchiveRepository;

  // finalized states
  stateArchive: StateArchiveRepository;

  // op pool
  aggregateAndProof: AggregateAndProofRepository;
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositEvent: DepositEventRepository;

  // eth1 processing
  preGenesisState: PreGenesisState;
  preGenesisStateLastProcessedBlock: PreGenesisStateLastProcessedBlock;

  // all deposit data roots and merkle tree
  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;

  // altair
  syncCommittee: SyncCommitteeCache;
  syncCommitteeContribution: SyncCommitteeContributionCache;
  bestUpdatePerCommitteePeriod: BestUpdatePerCommitteePeriod;
  latestFinalizedUpdate: LatestFinalizedUpdate;
  latestNonFinalizedUpdate: LatestNonFinalizedUpdate;
  lightclientFinalizedCheckpoint: LightclientFinalizedCheckpoint;

  processBlockOperations(signedBlock: allForks.SignedBeaconBlock): Promise<void>;

  /**
   * Start the connection to the db instance and open the db store.
   */
  start(): Promise<void>;

  /**
   *  Stop the connection to the db instance and close the db store.
   */
  stop(): Promise<void>;
}
