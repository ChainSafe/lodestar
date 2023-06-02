import {LevelDbControllerMetrics} from "@lodestar/db";
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
  // TODO DENEB: cleanup once fully migrated from blobsSidecar to blobSidecars
  BlobsSidecarRepository,
  BlobsSidecarArchiveRepository,
  BLSToExecutionChangeRepository,
} from "./repositories/index.js";
import {PreGenesisState, PreGenesisStateLastProcessedBlock} from "./single/index.js";

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

  // TODO DENEB: cleanup following two blobs... repos once BlobsSidecar fully migrated to BlobSidecars
  blobsSidecar: BlobsSidecarRepository;
  blobsSidecarArchive: BlobsSidecarArchiveRepository;

  // finalized states
  stateArchive: StateArchiveRepository;

  // op pool
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  depositEvent: DepositEventRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;

  // eth1 processing
  preGenesisState: PreGenesisState;
  preGenesisStateLastProcessedBlock: PreGenesisStateLastProcessedBlock;

  // all deposit data roots and merkle tree
  depositDataRoot: DepositDataRootRepository;
  eth1Data: Eth1DataRepository;

  // lightclient
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  backfilledRanges: BackfilledRanges;

  pruneHotDb(): Promise<void>;

  /** Start the connection to the db instance and open the db store. */
  start(): Promise<void>;
  /**  Stop the connection to the db instance and close the db store. */
  stop(): Promise<void>;
  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void;
}
