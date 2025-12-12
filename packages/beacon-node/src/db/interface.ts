import {LevelDbControllerMetrics} from "@lodestar/db";
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

  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

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

  pruneHotDb(): Promise<void>;

  /**  Close the connection to the db instance and close the db store. */
  close(): Promise<void>;
  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void;
}
