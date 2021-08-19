import {altair} from "@chainsafe/lodestar-types";
import {getCurrentEpoch} from "../../util";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {getRewardsPenaltiesDeltas} from "./balance";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags
 * are true, worst case: FLAG_UNSLASHED + FLAG_ELIGIBLE_ATTESTER + FLAG_PREV_*
 */
export function processRewardsAndPenalties(
  state: CachedBeaconState<altair.BeaconState>,
  epochProcess: IEpochProcess
): void {
  if (getCurrentEpoch(state) == GENESIS_EPOCH) {
    return;
  }

  const [rewards, penalties] = getRewardsPenaltiesDeltas(state, epochProcess);
  const deltas = rewards.map((_, i) => Number(rewards[i] - penalties[i]));
  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  // balances.updateAll(newBalances);
  // cache the balances array, too
  epochProcess.balances = state.balances.updateAll(deltas);
}

// // naive version, leave here for debugging purposes
// function processRewardsAndPenaltiesNAIVE() {
//   const flagDeltas = Array.from({length: PARTICIPATION_FLAG_WEIGHTS.length}, (_, flag) =>
//     getFlagIndexDeltas(state, process, flag)
//   );

//   const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(state, process);
//   flagDeltas.push(inactivityPenaltyDeltas);

//   const newBalances = new BigUint64Array(balances.length);
//   balances.forEach((balance, i) => {
//     let newBalance = balance;
//     for (const [rewards, penalties] of flagDeltas) {
//       const b = newBalance + BigInt(rewards[i] - penalties[i]);
//       if (b > 0) {
//         newBalance = b;
//       } else {
//         newBalance = BigInt(0);
//       }
//     }
//     newBalances[i] = newBalance;
//   });
// }
