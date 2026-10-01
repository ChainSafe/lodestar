import {createBeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes, toRootHex} from "@lodestar/utils";
import {
  prepareCheckpointApiInitialization,
  prepareCheckpointFileInitialization,
  prepareUnfinalizedCheckpointInitialization,
} from "./checkpointState.js";
import {prepareGenesisInitialization} from "./genesisState.js";
import {ArchivedStateBytes, StateInitialization, StateInitializationOptions, StatePreparationContext} from "./types.js";
import {assertAnchorStateForkMatchesConfig} from "./validation.js";

export function prepareArchivedStateInitialization(
  {stateBytes, metadata, isWithinWeakSubjectivityPeriod}: ArchivedStateBytes,
  {chainForkConfig, logger}: StatePreparationContext
): StateInitialization {
  const config = createBeaconConfig(chainForkConfig, metadata.genesisValidatorsRoot);
  return {
    stateBytes,
    config,
    isFinalized: true,
    validateBeforeLoad() {
      // Db staleness only warns, so it does not gate state loading.
    },
    validate(state) {
      assertAnchorStateForkMatchesConfig(config, state);
      const logData = {
        slot: state.slot,
        epoch: computeEpochAtSlot(state.slot),
        stateSize: formatBytes(stateBytes.length),
        stateRoot: toRootHex(state.hashTreeRoot()),
        isWithinWeakSubjectivityPeriod,
      };
      if (isWithinWeakSubjectivityPeriod) {
        logger.info("Initializing beacon from a valid db state", logData);
      } else {
        logger.warn("Initializing from a stale db state vulnerable to long range attacks", logData);
        logger.warn("Checkpoint sync recommended, please use --help to see checkpoint sync options");
      }
    },
    persist: null,
    log(state) {
      logger.info("Initialized state from db", {
        slot: state.slot,
        epoch: computeEpochAtSlot(state.slot),
        stateRoot: toRootHex(state.hashTreeRoot()),
        isFinalized: true,
      });
    },
  };
}

export async function prepareCheckpointOrGenesisInitialization(
  options: StateInitializationOptions,
  archived: ArchivedStateBytes | null,
  context: StatePreparationContext
): Promise<StateInitialization> {
  if (options.checkpointState) {
    return prepareCheckpointFileInitialization(options.checkpointState, options, archived, context);
  }
  if (options.checkpointSyncUrl) {
    return prepareCheckpointApiInitialization(options.checkpointSyncUrl, options, archived, context);
  }
  if (options.lastPersistedCheckpointState || options.unsafeCheckpointState) {
    const stateInit = await prepareUnfinalizedCheckpointInitialization(options, archived, context);
    if (stateInit !== null) return stateInit;
  }
  return prepareGenesisInitialization(options, context);
}
