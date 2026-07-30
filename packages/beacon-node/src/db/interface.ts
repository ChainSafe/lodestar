import {LevelDbControllerMetrics} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import type {Logger} from "@lodestar/utils";
import type {IFlatFileStore} from "./flatFileStore/interface.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
  BackfilledRanges,
  BestLightClientUpdateRepository,
  BlockArchiveRepository,
  BlockRepository,
  CheckpointHeaderRepository,
  ExecutionPayloadEnvelopeArchiveRepository,
  ExecutionPayloadEnvelopeRepository,
  ProposerSlashingRepository,
  StateArchiveRepository,
  SyncCommitteeRepository,
  SyncCommitteeWitnessRepository,
  VoluntaryExitRepository,
} from "./repositories/index.js";

/**
 * The DB service manages the data layer of the beacon chain
 * The exposed methods do not refer to the underlying data engine,
 * but instead expose relevant beacon chain objects
 */
export interface IBeaconDb {
  // unfinalized blocks
  block: BlockRepository;
  // finalized blocks
  blockArchive: BlockArchiveRepository;

  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;

  // finalized states
  stateArchive: StateArchiveRepository;
  // checkpoint states
  checkpointState: CheckpointStateRepository;

  // op pool
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

  flatFileStore: IFlatFileStore;
  initFlatFileStore(dataDir: string, finalizedCheckpointSlot: Slot, logger: Logger): Promise<void>;

  pruneHotDb(): Promise<void>;

  deleteDeprecatedEth1Data(): Promise<void>;

  /**  Close the connection to the db instance and close the db store. */
  close(): Promise<void>;
  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void;
}
