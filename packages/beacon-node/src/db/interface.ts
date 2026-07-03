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
 * but instead expose relevant beacon chain objects.
 *
 * Ownership is split by owner (BeaconEngine seam): `IBeaconEngineDb` holds the consensus stores the
 * engine owns (blocks, states, checkpoint states, payload envelopes, op-pool persistence); `IBeaconChainDb`
 * holds the DA + light-client + backfill stores the facade owns. `IBeaconDb` is their composition, held
 * only by the bootstrap (CLI / `BeaconNode`).
 */
export interface IBeaconEngineDb {
  // unfinalized blocks
  block: BlockRepository;
  // finalized blocks
  blockArchive: BlockArchiveRepository;

  // finalized states
  stateArchive: StateArchiveRepository;
  // checkpoint states
  checkpointState: CheckpointStateRepository;

  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;

  // op pool persistence (the OpPool is engine-owned)
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  attesterSlashing: AttesterSlashingRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;
}

export interface IBeaconChainDb {
  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  // lightclient
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  backfilledRanges: BackfilledRanges;
}

export interface IBeaconDb extends IBeaconChainDb, IBeaconEngineDb {
  pruneHotDb(): Promise<void>;

  deleteDeprecatedEth1Data(): Promise<void>;

  /**  Close the connection to the db instance and close the db store. */
  close(): Promise<void>;
  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void;
}
