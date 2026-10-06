import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {IBeaconDb} from "@lodestar/beacon-node";
import {BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {MAX_PENDING_DEPOSITS_PER_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  IBeaconStateView,
  computeWeakSubjectivitySummaryFromStateBytes,
  createBeaconStateView,
  getValidatorCountFromStateBytes,
  isWithinWeakSubjectivityPeriodFromSummary,
  readBeaconStateBytesMetadata,
} from "@lodestar/state-transition";
import {Logger, formatBytes} from "@lodestar/utils";
import {GlobalArgs} from "../../options/globalOptions.js";
import {BeaconArgs} from "./options.js";
import {loadPubkeysFile} from "./pubkeysFile.js";
import {StateInitializationError, StateInitializationErrorCode} from "./stateInitialization/errors.js";
import {prepareGenesisInitialization} from "./stateInitialization/genesisState.js";
import {
  prepareArchivedStateInitialization,
  prepareCheckpointSourceInitialization,
} from "./stateInitialization/prepareStateInitialization.js";
import {
  ArchivedStateBytes,
  StateInitialization,
  StateInitializationOptions,
  StatePreparationContext,
} from "./stateInitialization/types.js";

type InitBeaconStateResult = {anchorState: IBeaconStateView; config: BeaconConfig; isFinalized: boolean};

/**
 * Select serialized anchor bytes before constructing the state used for validation, persistence, and return.
 * Populates the global `pubkeyCache` with the anchor state's validators, reusing `pubkeysFile` if it matches.
 */
export async function initBeaconState(
  args: BeaconArgs & GlobalArgs,
  dataDir: string,
  pubkeysFile: string,
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<InitBeaconStateResult> {
  const options: StateInitializationOptions = args;
  const nativeStateTransition = options["chain.nativeStateTransition"] ?? false;
  if (
    options.forceCheckpointSync &&
    !(options.checkpointState || options.checkpointSyncUrl || options.unsafeCheckpointState)
  ) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.INVALID_CHECKPOINT_SOURCE},
      "Forced checkpoint sync without specifying a checkpointState, checkpointSyncUrl or unsafeCheckpointState"
    );
  }
  const context: StatePreparationContext = {chainForkConfig, db, dataDir, logger};
  const archived = await readLatestArchivedStateBytes(context);
  if (archived !== null) {
    if (options.forceCheckpointSync && archived.isWithinWeakSubjectivityPeriod) {
      logger.warn("Forced syncing from checkpoint even though db state is within weak subjectivity period", {
        slot: archived.metadata.slot,
      });
      logger.warn("Please consider removing --forceCheckpointSync flag unless absolutely necessary");
    }
    const hasCheckpointSource = Boolean(
      options.checkpointState ||
        options.checkpointSyncUrl ||
        options.unsafeCheckpointState ||
        options.lastPersistedCheckpointState
    );
    if (!options.forceCheckpointSync && (!hasCheckpointSource || archived.isWithinWeakSubjectivityPeriod)) {
      return executeStateInitialization(
        prepareArchivedStateInitialization(archived, context),
        nativeStateTransition,
        pubkeysFile,
        logger
      );
    }
  }
  let stateInit = await prepareCheckpointSourceInitialization(options, archived, context);
  if (stateInit === null) {
    // Without a usable checkpoint state, resume from the db as if no checkpoint source was set instead of genesis
    stateInit =
      archived !== null
        ? prepareArchivedStateInitialization(archived, context)
        : await prepareGenesisInitialization(options, context);
  }
  return executeStateInitialization(stateInit, nativeStateTransition, pubkeysFile, logger);
}

/**
 * Read the archived DB anchor without constructing a state. Retain its metadata, weak-subjectivity summary,
 * and period verdict so selection and initialization use the same result without rescanning or checking time again.
 */
async function readLatestArchivedStateBytes({
  chainForkConfig,
  db,
  logger,
}: StatePreparationContext): Promise<ArchivedStateBytes | null> {
  const slot = await db.stateArchive.lastKey();
  const bytes = slot === null ? null : await db.stateArchive.getBinary(slot);
  if (bytes === null) return null;
  logger.verbose("Found the last archived state", {slot, size: formatBytes(bytes.length)});
  const stateBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metadata = readBeaconStateBytesMetadata(stateBytes);
  if (metadata === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      "Cannot read metadata from archived state bytes"
    );
  }
  const weakSubjectivity = computeWeakSubjectivitySummaryFromStateBytes(chainForkConfig, stateBytes, metadata);
  if (weakSubjectivity === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      `Cannot extract weak subjectivity summary from archived state bytes, expected ${chainForkConfig.getForkName(metadata.slot)} state at slot ${metadata.slot}, possible fork or network mismatch`
    );
  }
  return {
    stateBytes,
    metadata,
    weakSubjectivity,
    isWithinWeakSubjectivityPeriod: isWithinWeakSubjectivityPeriodFromSummary(chainForkConfig, weakSubjectivity),
  };
}

/**
 * Shared completion template for all sources: construct only the selected state, exactly once.
 * Validate before persistence, and log success only after any required writes succeed.
 */
async function executeStateInitialization(
  stateInit: StateInitialization,
  nativeStateTransition: boolean,
  pubkeysFile: string,
  logger: Logger
): Promise<InitBeaconStateResult> {
  const {config, stateBytes} = stateInit;
  const validatorCount = getValidatorCountFromStateBytes(config, stateBytes);
  if (validatorCount === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      "Cannot read validator count from selected state bytes"
    );
  }
  // Reserve 3 months of worst-case registry growth (MAX_PENDING_DEPOSITS_PER_EPOCH per epoch),
  // over a year at organic rates, to avoid routine cache reallocations. Cache growth is protected
  // by its native lock; if this headroom is exceeded, it grows by the same fixed step.
  // The view syncs pubkeys during construction, so capacity must be reserved first.
  const headroomEpochs = (90 * 24 * 60 * 60) / (config.SECONDS_PER_SLOT * SLOTS_PER_EPOCH);
  const pubkeyCacheCapacity = validatorCount + MAX_PENDING_DEPOSITS_PER_EPOCH * Math.ceil(headroomEpochs);
  loadPubkeysFile(pubkeyCache, pubkeysFile, pubkeyCacheCapacity, config, stateBytes, validatorCount, logger);
  // unilaterally expand capacity after best-effort pubkey file loading
  pubkeyCache.ensureCapacity(pubkeyCacheCapacity);
  const anchorState = createBeaconStateView({nativeStateTransition, config, stateBytes});
  stateInit.validate(anchorState);
  await stateInit.persist?.(anchorState, stateBytes);
  stateInit.log(anchorState);
  return {anchorState, config, isFinalized: stateInit.isFinalized};
}
