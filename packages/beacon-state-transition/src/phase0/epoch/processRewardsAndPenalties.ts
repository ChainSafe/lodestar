import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {getAttestationDeltas} from "./getAttestationDeltas";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags
 * are true, worst case: FLAG_UNSLASHED + FLAG_ELIGIBLE_ATTESTER + FLAG_PREV_*
 */
export function processRewardsAndPenalties(
  state: CachedBeaconState<phase0.BeaconState>,
  epochProcess: IEpochProcess
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (epochProcess.currentEpoch === GENESIS_EPOCH) {
    return;
  }
  const [rewards, penalties] = getAttestationDeltas(state, epochProcess);
  const deltas = rewards.map((_, i) => rewards[i] - penalties[i]);
  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  // balances.updateAll(newBalances);
  // cache the balances array, too
  epochProcess.balances = state.balances.updateAll(deltas);
}
