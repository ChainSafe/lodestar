import {MIN_EPOCHS_TO_INACTIVITY_PENALTY} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "../allForks/util";

export function getFinalityDelay(state: CachedBeaconState<allForks.BeaconState>): number {
  return state.previousShuffling.epoch - state.finalizedCheckpoint.epoch;
}

/**
 * If the chain has not been finalized for >4 epochs, the chain enters an "inactivity leak" mode,
 * where inactive validators get progressively penalized more and more, to reduce their influence
 * until blocks get finalized again. See here (https://github.com/ethereum/annotated-spec/blob/master/phase0/beacon-chain.md#inactivity-quotient) for what the inactivity leak is, what it's for and how
 * it works.
 */
export function isInInactivityLeak(state: CachedBeaconState<allForks.BeaconState>): boolean {
  return getFinalityDelay(state) > MIN_EPOCHS_TO_INACTIVITY_PENALTY;
}
