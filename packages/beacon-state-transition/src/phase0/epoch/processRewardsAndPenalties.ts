import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";

import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {getAttestationDeltas} from "./getAttestationDeltas";

// TODO: Move processRewardsAndPenalties to allForks and add
// ```
// fork === ForkName.phase0 ? getAttestationDeltas() : getRewardsPenaltiesDeltas()
// ```
//
// Right now it can't work because getRewardsPenaltiesDeltas() returns bigint[],
// and getAttestationDeltas() returns number[]

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * NOTE: For spec tests MUST run afterProcessEpoch() to apply changes in epochProcess.balancesFlat to the tree
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

  for (let i = 0, len = epochProcess.balancesFlat.length; i < len; i++) {
    const prevBalance = epochProcess.balancesFlat[i];
    const nextBalance = prevBalance + BigInt(rewards[i] - penalties[i]);
    if (nextBalance > 0 && nextBalance !== prevBalance) {
      epochProcess.balancesFlat[i] = nextBalance;
    }
  }

  // Note: don't set balances to the state here. See IEpochProcess JSDocs for context
  // Balances will be set to the state at once after completing the epoch transition
}
