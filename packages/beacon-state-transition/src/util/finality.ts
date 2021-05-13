import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {getPreviousEpoch} from "./epoch";

export function getFinalityDelay(config: IBeaconConfig, state: allForks.BeaconState): number {
  return getPreviousEpoch(config, state) - state.finalizedCheckpoint.epoch;
}

/**
 * If the chain has not been finalized for >4 epochs, the chain enters an "inactivity leak" mode,
 * where inactive validators get progressively penalized more and more, to reduce their influence
 * until blocks get finalized again. See here (https://github.com/ethereum/annotated-spec/blob/master/phase0/beacon-chain.md#inactivity-quotient) for what the inactivity leak is, what it's for and how
 * it works.
 */
export function isInInactivityLeak(config: IBeaconConfig, state: allForks.BeaconState): boolean {
  return getFinalityDelay(config, state) > config.params.MIN_EPOCHS_TO_INACTIVITY_PENALTY;
}
