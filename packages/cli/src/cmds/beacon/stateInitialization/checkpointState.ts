import {DbCPStateDatastore, FileCPStateDatastore, persistAnchorState} from "@lodestar/beacon-node";
import {createBeaconConfig} from "@lodestar/config";
import {
  IBeaconStateView,
  computeEpochAtSlot,
  computeWeakSubjectivitySummaryFromStateBytes,
  getCurrentSlot,
  isWithinWeakSubjectivityPeriodFromSummary,
  readBeaconStateBytesMetadata,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {formatBytes, toRootHex} from "@lodestar/utils";
import {fetchWeakSubjectivityStateBytes, getCheckpointFromArg} from "../../../networks/index.js";
import {downloadOrLoadFile} from "../../../util/index.js";
import {StateInitializationError, StateInitializationErrorCode} from "./errors.js";
import {
  ArchivedStateBytes,
  CheckpointStartupPolicy,
  CheckpointStateBytesCandidate,
  StateInitialization,
  StateInitializationOptions,
  StatePreparationContext,
} from "./types.js";
import {assertAnchorStateForkMatchesConfig} from "./validation.js";

type CheckpointOptions = Pick<
  StateInitializationOptions,
  "wssCheckpoint" | "forceCheckpointSync" | "ignoreWeakSubjectivityCheck"
>;

export async function prepareCheckpointFileInitialization(
  checkpointState: string,
  options: CheckpointOptions,
  archived: ArchivedStateBytes | null,
  context: StatePreparationContext
): Promise<StateInitialization> {
  context.logger.info("Loading checkpoint state", {checkpointState});
  const bytes = await downloadOrLoadFile(checkpointState);
  const stateBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  context.logger.info("Loaded checkpoint state", {checkpointState, size: formatBytes(stateBytes.length)});
  return prepareCheckpointInitialization(
    {
      stateBytes,
      expectedCheckpoint: options.wssCheckpoint ? getCheckpointFromArg(options.wssCheckpoint) : null,
      source: "checkpoint file",
    },
    archived,
    {
      isFinalized: true,
      forceCheckpointSync: Boolean(options.forceCheckpointSync),
      ignoreWeakSubjectivityCheck: Boolean(options.ignoreWeakSubjectivityCheck),
    },
    context
  );
}

export async function prepareCheckpointApiInitialization(
  checkpointSyncUrl: string,
  options: CheckpointOptions,
  archived: ArchivedStateBytes | null,
  context: StatePreparationContext
): Promise<StateInitialization> {
  const {chainForkConfig, logger} = context;
  try {
    const url = new URL(checkpointSyncUrl);
    logger.info("Fetching checkpoint state", {checkpointSyncUrl: url.origin});
  } catch (error) {
    logger.error("Invalid checkpoint sync URL", {checkpointSyncUrl}, error as Error);
    throw error;
  }
  const {stateBytes, expectedCheckpoint} = await fetchWeakSubjectivityStateBytes(chainForkConfig, logger, {
    checkpointSyncUrl,
    wssCheckpoint: options.wssCheckpoint,
  });
  return prepareCheckpointInitialization(
    {stateBytes, expectedCheckpoint, source: "checkpointSyncUrl"},
    archived,
    {
      isFinalized: true,
      forceCheckpointSync: Boolean(options.forceCheckpointSync),
      ignoreWeakSubjectivityCheck: Boolean(options.ignoreWeakSubjectivityCheck),
    },
    context
  );
}

export async function prepareUnfinalizedCheckpointInitialization(
  options: CheckpointOptions &
    Pick<
      StateInitializationOptions,
      "lastPersistedCheckpointState" | "unsafeCheckpointState" | "chain.nHistoricalStatesFileDataStore"
    >,
  archived: ArchivedStateBytes | null,
  context: StatePreparationContext
): Promise<StateInitialization | null> {
  const {db, dataDir, logger} = context;
  let bytes: Uint8Array | null = null;
  if (options.lastPersistedCheckpointState && !options.forceCheckpointSync) {
    const store = options["chain.nHistoricalStatesFileDataStore"]
      ? new FileCPStateDatastore(dataDir)
      : new DbCPStateDatastore(db);
    logger.verbose(`Finding last persisted checkpoint state from ${store.constructor.name}`);
    bytes = await store.readLatestSafe();
    if (bytes === null) {
      logger.warn("Last persisted checkpoint state not found");
    } else {
      logger.info("Found last persisted checkpoint state", {size: formatBytes(bytes.length)});
    }
  }
  if (bytes === null && options.unsafeCheckpointState) {
    logger.info("Loading checkpoint state", {unsafeCheckpointState: options.unsafeCheckpointState});
    bytes = await downloadOrLoadFile(options.unsafeCheckpointState);
    logger.info("Loaded checkpoint state", {size: formatBytes(bytes.length)});
  }
  if (bytes === null) return null;
  logger.warn(
    "Initializing from unfinalized checkpoint state is unsafe and may cause the node to follow a minority chain"
  );
  const stateBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return prepareCheckpointInitialization(
    {
      stateBytes,
      expectedCheckpoint: options.wssCheckpoint ? getCheckpointFromArg(options.wssCheckpoint) : null,
      source: "unfinalized source",
    },
    archived,
    {
      isFinalized: false,
      forceCheckpointSync: Boolean(options.forceCheckpointSync),
      ignoreWeakSubjectivityCheck: Boolean(options.ignoreWeakSubjectivityCheck),
    },
    context
  );
}

function prepareCheckpointInitialization(
  candidate: CheckpointStateBytesCandidate,
  archived: ArchivedStateBytes | null,
  policy: CheckpointStartupPolicy,
  {chainForkConfig, db, logger}: StatePreparationContext
): StateInitialization {
  const candidateMetadata = readBeaconStateBytesMetadata(candidate.stateBytes);
  if (candidateMetadata === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      `Cannot read state metadata from ${candidate.source}`
    );
  }
  if (
    archived !== null &&
    (archived.metadata.genesisTime !== candidateMetadata.genesisTime ||
      !ssz.Root.equals(archived.metadata.genesisValidatorsRoot, candidateMetadata.genesisValidatorsRoot))
  ) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.INCOMPATIBLE_GENESIS},
      "Db state and checkpoint state are not compatible, either clear the db or verify your checkpoint source"
    );
  }
  const useArchived =
    archived !== null && archived.metadata.slot > candidateMetadata.slot && !policy.forceCheckpointSync;
  if (useArchived) {
    logger.verbose(
      "Db state is ahead of the provided checkpoint state, using the db state to initialize the beacon chain"
    );
  }
  const {stateBytes, metadata, weakSubjectivity} = useArchived
    ? archived
    : {
        stateBytes: candidate.stateBytes,
        metadata: candidateMetadata,
        weakSubjectivity: computeWeakSubjectivitySummaryFromStateBytes(
          chainForkConfig,
          candidate.stateBytes,
          candidateMetadata
        ),
      };
  if (weakSubjectivity === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      `Cannot extract weak subjectivity summary from ${candidate.source}, expected ${chainForkConfig.getForkName(metadata.slot)} state at slot ${metadata.slot}, possible fork or network mismatch`
    );
  }
  const expectedCheckpoint = useArchived ? null : candidate.expectedCheckpoint;
  const source = useArchived ? "db" : candidate.source;
  const {isFinalized, ignoreWeakSubjectivityCheck} = policy;
  const config = createBeaconConfig(chainForkConfig, metadata.genesisValidatorsRoot);
  const archivedWithinWeakSubjectivityPeriod = useArchived ? archived.isWithinWeakSubjectivityPeriod : null;
  const passedValidation =
    archivedWithinWeakSubjectivityPeriod ?? isWithinWeakSubjectivityPeriodFromSummary(config, weakSubjectivity);
  // Fast-fail stale checkpoints before deserializing the state or reserving pubkey-cache capacity.
  if (!passedValidation && !ignoreWeakSubjectivityCheck) {
    const clockEpoch = computeEpochAtSlot(getCurrentSlot(config, weakSubjectivity.genesisTime));
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.STALE_CHECKPOINT},
      `The selected state with epoch ${weakSubjectivity.checkpointEpoch} is not within weak subjectivity period of ${weakSubjectivity.period} epochs from the current epoch ${clockEpoch}. Please verify your checkpoint source`
    );
  }
  // DB-selected anchors need no persistence, including at slot zero.
  const shouldPersist = isFinalized && !useArchived;
  return {
    stateBytes,
    config,
    isFinalized,
    validate(state) {
      // A supplied checkpoint must match even when the period check is ignored.
      if (expectedCheckpoint !== null) assertStateMatchesCheckpoint(state, expectedCheckpoint);
      assertAnchorStateForkMatchesConfig(config, state);
      if (isFinalized) {
        const source = useArchived ? "db" : "checkpoint";
        const logData = {
          slot: state.slot,
          epoch: computeEpochAtSlot(state.slot),
          stateSize: formatBytes(stateBytes.length),
          stateRoot: toRootHex(state.hashTreeRoot()),
          isWithinWeakSubjectivityPeriod: passedValidation,
        };
        if (passedValidation) {
          logger.info(`Initializing beacon from a valid ${source} state`, logData);
        } else {
          logger.warn(`Initializing from a stale ${source} state vulnerable to long range attacks`, logData);
          logger.warn("Checkpoint sync recommended, please use --help to see checkpoint sync options");
        }
      }
    },
    async initializeEarliestAvailableSlot(state) {
      const stored = await db.earliestAvailableSlot.get();
      const floor = useArchived ? (stored ?? state.slot) : Math.max(stored ?? 0, state.slot);
      if (stored !== floor) {
        await db.earliestAvailableSlot.set(floor);
      }
      logger.verbose("Initialized earliest available slot", {
        source,
        anchorSlot: state.slot,
        previousSlot: stored,
        earliestAvailableSlot: floor,
      });
      return floor;
    },
    persist: shouldPersist ? (state, bytes) => persistAnchorState(config, db, state, bytes) : null,
    log(state) {
      const {checkpoint} = state.computeAnchorCheckpoint();
      logger.info("Initialized checkpoint state", {
        source,
        slot: state.slot,
        epoch: checkpoint.epoch,
        stateSize: formatBytes(stateBytes.length),
        stateRoot: toRootHex(state.hashTreeRoot()),
        checkpointRoot: toRootHex(checkpoint.root),
        isFinalized,
        ...(isFinalized ? {} : {lastProcessedSlot: state.latestBlockHeader.slot}),
      });
    },
  };
}

function assertStateMatchesCheckpoint(state: IBeaconStateView, checkpoint: Checkpoint): void {
  const {root: blockRoot, epoch: stateEpoch} = state.computeAnchorCheckpoint().checkpoint;
  if (!ssz.Root.equals(blockRoot, checkpoint.root)) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.CHECKPOINT_ROOT_MISMATCH},
      `Roots do not match.  expected=${toRootHex(checkpoint.root)}, actual=${toRootHex(blockRoot)}`
    );
  }
  if (!ssz.Epoch.equals(stateEpoch, checkpoint.epoch)) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.CHECKPOINT_EPOCH_MISMATCH},
      `Epochs do not match.  expected=${checkpoint.epoch}, actual=${stateEpoch}`
    );
  }
}
