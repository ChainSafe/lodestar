import {persistAnchorState} from "@lodestar/beacon-node";
import {createBeaconConfig} from "@lodestar/config";
import {
  computeEpochAtSlot,
  computeWeakSubjectivitySummaryFromStateBytes,
  isWithinWeakSubjectivityPeriodFromSummary,
  readBeaconStateBytesMetadata,
} from "@lodestar/state-transition";
import {formatBytes, toRootHex} from "@lodestar/utils";
import {getGenesisFileUrl, getGenesisStateRoot} from "../../../networks/index.js";
import {defaultNetwork} from "../../../options/globalOptions.js";
import {downloadOrLoadFile} from "../../../util/index.js";
import {StateInitializationError, StateInitializationErrorCode} from "./errors.js";
import {StateInitialization, StateInitializationOptions, StatePreparationContext} from "./types.js";
import {assertAnchorStateForkMatchesConfig} from "./validation.js";

export async function prepareGenesisInitialization(
  options: Pick<StateInitializationOptions, "genesisStateFile" | "network">,
  {chainForkConfig, db, logger}: StatePreparationContext
): Promise<StateInitialization> {
  const source = options.genesisStateFile || getGenesisFileUrl(options.network || defaultNetwork);
  if (!source) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MISSING_INITIALIZATION_SOURCE},
      "Failed to initialize beacon state, please provide a genesis state file or use checkpoint sync"
    );
  }
  logger.info("Loading genesis state", {genesisStateFile: source});
  const bytes = await downloadOrLoadFile(source);
  const stateBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  logger.info("Loaded genesis state", {size: formatBytes(stateBytes.length)});
  const metadata = readBeaconStateBytesMetadata(stateBytes);
  if (metadata === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      "Cannot read metadata from genesis state bytes"
    );
  }
  const weakSubjectivity = computeWeakSubjectivitySummaryFromStateBytes(chainForkConfig, stateBytes, metadata);
  if (weakSubjectivity === null) {
    throw new StateInitializationError(
      {code: StateInitializationErrorCode.MALFORMED_STATE_BYTES},
      `Cannot extract weak subjectivity summary from genesis state bytes, expected ${chainForkConfig.getForkName(metadata.slot)} state at slot ${metadata.slot}, possible fork or network mismatch`
    );
  }
  const config = createBeaconConfig(chainForkConfig, metadata.genesisValidatorsRoot);
  const expectedRoot = getGenesisStateRoot(options.network);
  return {
    stateBytes,
    config,
    isFinalized: true,
    validate(state) {
      const stateRoot = toRootHex(state.hashTreeRoot());
      if (expectedRoot !== null && stateRoot !== expectedRoot) {
        throw new StateInitializationError(
          {code: StateInitializationErrorCode.GENESIS_ROOT_MISMATCH},
          `Genesis state root mismatch expected=${expectedRoot} received=${stateRoot}`
        );
      }
      assertAnchorStateForkMatchesConfig(config, state);
      const passedValidation = isWithinWeakSubjectivityPeriodFromSummary(config, weakSubjectivity);
      const logData = {
        slot: state.slot,
        epoch: computeEpochAtSlot(state.slot),
        stateSize: formatBytes(stateBytes.length),
        stateRoot,
        isWithinWeakSubjectivityPeriod: passedValidation,
      };
      if (passedValidation) {
        logger.info("Initializing beacon from a valid checkpoint state", logData);
      } else {
        logger.warn("Initializing from a stale checkpoint state vulnerable to long range attacks", logData);
        logger.warn("Checkpoint sync recommended, please use --help to see checkpoint sync options");
      }
    },
    async initializeEarliestAvailableSlot(state) {
      const stored = await db.earliestAvailableSlot.get();
      if (stored !== null && stored !== state.slot) {
        logger.warn("Resetting earliest available slot for genesis initialization", {
          previousSlot: stored,
          earliestAvailableSlot: state.slot,
        });
      }
      if (stored !== state.slot) {
        await db.earliestAvailableSlot.set(state.slot);
      }
      return state.slot;
    },
    persist: (state, bytes) => persistAnchorState(config, db, state, bytes),
    log(state, nativeStateTransition) {
      logger.info("Initialized genesis state", {
        slot: state.slot,
        stateRoot: toRootHex(state.hashTreeRoot()),
        isFinalized: true,
        nativeStateTransition,
      });
    },
  };
}
