import {LevelDbControllerMetrics} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import type {IDataColumnStore} from "./dataColumnStore.js";
import type {FlatFileStoreMetrics} from "./flatFileStore/metrics.js";
import {CheckpointStateRepository} from "./repositories/checkpointState.js";
import {EarliestAvailableSlotRepository} from "./repositories/earliestAvailableSlot.js";
import {
  AttesterSlashingRepository,
  BLSToExecutionChangeRepository,
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
  ProposerPreferencesRepository,
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
 * engine owns (blocks, states, checkpoint states, envelopes, op-pool persistence); `IBeaconChainDb`
 * retains read access to blocks and envelopes, plus the DA + light-client + backfill stores the facade owns. `IBeaconDb` is their composition, held
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
  earliestAvailableSlot: EarliestAvailableSlotRepository;

  executionPayloadEnvelope: ExecutionPayloadEnvelopeRepository;
  executionPayloadEnvelopeArchive: ExecutionPayloadEnvelopeArchiveRepository;

  // op pool persistence (the OpPool is engine-owned)
  voluntaryExit: VoluntaryExitRepository;
  proposerSlashing: ProposerSlashingRepository;
  proposerPreferences: ProposerPreferencesRepository;
  attesterSlashing: AttesterSlashingRepository;
  blsToExecutionChange: BLSToExecutionChangeRepository;
}

export interface IBeaconChainDb {
  block: Pick<BlockRepository, "get" | "getBinary">;
  blockArchive: Pick<
    BlockArchiveRepository,
    | "getBinary"
    | "firstKey"
    | "keys"
    | "getBinaryEntryByRoot"
    | "getRootBySlot"
    | "getSlotByRoot"
    | "getSlotByParentRoot"
    | "binaryEntriesStream"
    | "decodeKey"
  >;

  executionPayloadEnvelope: Pick<ExecutionPayloadEnvelopeRepository, "get" | "getBinary">;
  executionPayloadEnvelopeArchive: Pick<
    ExecutionPayloadEnvelopeArchiveRepository,
    "getBinary" | "binaryEntriesStream" | "decodeKey"
  >;

  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;

  // lightclient
  bestLightClientUpdate: BestLightClientUpdateRepository;
  checkpointHeader: CheckpointHeaderRepository;
  syncCommittee: SyncCommitteeRepository;
  syncCommitteeWitness: SyncCommitteeWitnessRepository;

  dataColumns: IDataColumnStore;
  /** Highest legacy column slot at startup; later archival writes the block-root index first. */
  readonly lastLegacyArchiveSlot: Slot | null;
}

export type IBeaconDb = IBeaconChainDb &
  IBeaconEngineDb & {
    init(): Promise<void>;
    pruneHotDb(): Promise<void>;

    deleteDeprecatedEth1Data(): Promise<void>;

    /**  Close the connection to the db instance and close the db store. */
    close(): Promise<void>;
    /** To inject metrics after CLI initialization */
    setMetrics(metrics: LevelDbControllerMetrics, flatFileStoreMetrics?: FlatFileStoreMetrics | null): void;
  };
