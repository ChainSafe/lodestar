import {BeaconState, Epoch, Shard} from "../../../types";
import {generateSeed,getCurrentEpochCommitteeCount, isPowerOfTwo} from "../../../helpers/stateTransitionHelpers";
import {SHARD_COUNT} from "../../../constants";
import BN from "bn.js";
import {isValidCrosslink, processExitQueue, processSlashing} from "./helpers";

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

  if (state.finalizedEpoch.gt(state.validatorRegistryUpdateEpoch) && isValidCrosslink(state)) {
    state.currentShufflingEpoch = nextEpoch;
    state.currentShufflingStartShard = (state.currentShufflingStartShard.addn(getCurrentEpochCommitteeCount(state))).mod(new BN(SHARD_COUNT));
    state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
  } else {
    const epochsSinceLastRegistryUpdate = currentEpoch.sub(state.validatorRegistryUpdateEpoch);
    if (epochsSinceLastRegistryUpdate.gtn(1) && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
      state.currentShufflingEpoch = nextEpoch;
      state.currentShufflingSeed = generateSeed(state, state.currentShufflingEpoch);
    }
  }

  processSlashing(state);
  processExitQueue(state);
}
