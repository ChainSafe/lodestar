import {CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Gwei} from "@chainsafe/lodestar-types";

/**
 * Get justified effectiveBalances from `justifiedState` for the fork-choice.
 *
 * Note: Original code and spec require to give 0 weight to validators that are not active.
 * To make this function fast, it will just re-use the existing cache of effectiveBalances, used to process
 * attestations fast. If this function looped through the validators array to check if they are active or not
 * it would defeat the purpose of this optimization.
 *
 * Gossip validation and block validation do not allow attestations from inactive validators to get to this point.
 * So we'll take the trade-off for performance to _not_ set the effectiveBalance of inactive validators to 0,
 * assuming that their attestations would never make it here. This might not be a safe assumption in case of heavy
 * forking, so it would be good to review this assumption when possible.
 *
 * TODO: After representing state.validators LeafNodes as struct, benchmark the cost of reading directly from the state.
 */
export function getEffectiveBalances(justifiedState: CachedBeaconState<allForks.BeaconState>): Gwei[] {
  const effectiveBalances = justifiedState.effectiveBalances.toArray();

  return effectiveBalances;
}
