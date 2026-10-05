import {createBeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {formatBytes, toRootHex} from "@lodestar/utils";
import {
  prepareCheckpointApiInitialization,
  prepareCheckpointFileInitialization,
  prepareUnfinalizedCheckpointInitialization,
} from "./checkpointState.js";
import {ArchivedStateBytes, StateInitialization, StateInitializationOptions, StatePreparationContext} from "./types.js";
import {assertAnchorStateForkMatchesConfig} from "./validation.js";

export function prepareArchivedStateInitialization(
  {stateBytes, metadata, isWithinWeakSubjectivityPeriod}: ArchivedStateBytes,
  {chainForkConfig, db, logger}: StatePreparationContext
): StateInitialization {
  const config = createBeaconConfig(chainForkConfig, metadata.genesisValidatorsRoot);
  return {
    stateBytes,
    config,
    isFinalized: true,
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
    async initializeEarliestAvailableSlot(state) {
      const stored = await db.earliestAvailableSlot.get();
      // we bootstrap the node with archived db, use the previous earliestAvailableSLot
      if (stored !== null) {
        logger.verbose("Reusing persisted earliest available slot", {
          anchorSlot: state.slot,
          earliestAvailableSlot: stored,
        });
        return stored;
      }
      // legacy db: blockArchive.firstKey() is not a safe floor, a past checkpoint sync may have left a gap.
      await db.earliestAvailableSlot.set(state.slot);
      return state.slot;
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

export async function prepareCheckpointSourceInitialization(
  options: StateInitializationOptions,
  archived: ArchivedStateBytes | null,
  context: StatePreparationContext
): Promise<StateInitialization | null> {
  if (options.checkpointState) {
    return prepareCheckpointFileInitialization(options.checkpointState, options, archived, context);
  }
  if (options.checkpointSyncUrl) {
    return prepareCheckpointApiInitialization(options.checkpointSyncUrl, options, archived, context);
  }
  if (options.lastPersistedCheckpointState || options.unsafeCheckpointState) {
    return prepareUnfinalizedCheckpointInitialization(options, archived, context);
  }
  return null;
}
