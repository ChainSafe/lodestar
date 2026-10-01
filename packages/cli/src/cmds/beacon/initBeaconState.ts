import {IBeaconDb, getStateTypeFromBytes} from "@lodestar/beacon-node";
import {ChainForkConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  computeWeakSubjectivitySummaryFromStateBytes,
  isWithinWeakSubjectivityPeriodFromSummary,
  readBeaconStateBytesMetadata,
} from "@lodestar/state-transition";
import {Logger, formatBytes} from "@lodestar/utils";
import {GlobalArgs} from "../../options/globalOptions.js";
import {BeaconArgs} from "./options.js";
import {StateInitializationError, StateInitializationErrorCode} from "./stateInitialization/errors.js";
import {
  prepareArchivedStateInitialization,
  prepareCheckpointOrGenesisInitialization,
} from "./stateInitialization/prepareStateInitialization.js";
import {
  ArchivedStateBytes,
  StateInitialization,
  StateInitializationOptions,
  StatePreparationContext,
} from "./stateInitialization/types.js";

/** Select serialized anchor bytes before constructing the state used for validation, persistence, and return. */
export async function initBeaconState(
  args: BeaconArgs & GlobalArgs,
  dataDir: string,
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<{anchorState: BeaconStateAllForks; stateBytes: Uint8Array; isFinalized: boolean}> {
  const options: StateInitializationOptions = args;
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
      return executeStateInitialization(prepareArchivedStateInitialization(archived, context));
    }
  }
  const stateInit = await prepareCheckpointOrGenesisInitialization(options, archived, context);
  return executeStateInitialization(stateInit);
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
      "Cannot extract weak subjectivity summary from archived state bytes"
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
  stateInit: StateInitialization
): Promise<{anchorState: BeaconStateAllForks; stateBytes: Uint8Array; isFinalized: boolean}> {
  const stateType = getStateTypeFromBytes(stateInit.config, stateInit.stateBytes);
  const anchorState = stateType.deserializeToViewDU(stateInit.stateBytes);
  stateInit.validate(anchorState);
  await stateInit.persist?.(anchorState, stateInit.stateBytes);
  stateInit.log(anchorState);
  return {anchorState, stateBytes: stateInit.stateBytes, isFinalized: stateInit.isFinalized};
}
