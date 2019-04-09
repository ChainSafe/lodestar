import {BeaconState, Epoch} from "../../../types";
import {generateSeed,getCurrentEpochCommitteeCount, isPowerOfTwo} from "../../helpers/stateTransitionHelpers";
import {SHARD_COUNT} from "../../../constants";
import BN from "bn.js";
import {isValidCrosslink, processExitQueue, processSlashings, updateValidatorRegistry} from "./helpers";

/**
 * Main function to process the validator registry and shuffle seed data.
 * @param {BeaconState} state
 * @param {Epoch} currentEpoch
 * @param {Epoch} nextEpoch
 */
export function processValidatorRegistryAndShuffleSeedData(
  state: BeaconState,
  currentEpoch: Epoch,
  nextEpoch: Epoch): void {

  state.previousShufflingEpoch = state.currentShufflingEpoch;
  state.previousShufflingStartShard = state.currentShufflingStartShard;
  state.previousShufflingSeed = state.currentShufflingSeed;

  if (state.finalizedEpoch > state.validatorRegistryUpdateEpoch && isValidCrosslink(state)) {
    updateValidatorRegistry(state);
    state.currentShufflingEpoch = nextEpoch;
    state.currentShufflingStartShard = (state.currentShufflingStartShard + getCurrentEpochCommitteeCount(state)) % SHARD_COUNT;
    state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
  } else {
    const epochsSinceLastRegistryUpdate = currentEpoch - state.validatorRegistryUpdateEpoch;
    if (epochsSinceLastRegistryUpdate > 1 && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
      state.currentShufflingEpoch = nextEpoch;
      state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
    }
  }

  processSlashings(state);
  processExitQueue(state);
}
