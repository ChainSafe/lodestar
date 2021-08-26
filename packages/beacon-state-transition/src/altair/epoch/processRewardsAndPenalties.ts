import {altair} from "@chainsafe/lodestar-types";
import {CachedBeaconState, IEpochProcess} from "../../allForks/util";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {getRewardsPenaltiesDeltas} from "./balance";

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
  state: CachedBeaconState<altair.BeaconState>,
  epochProcess: IEpochProcess
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (epochProcess.currentEpoch === GENESIS_EPOCH) {
    return;
  }

  const [rewards, penalties] = getRewardsPenaltiesDeltas(state, epochProcess);

  for (let i = 0, len = epochProcess.balancesFlat.length; i < len; i++) {
    const prevBalance = epochProcess.balancesFlat[i];
    const nextBalance = prevBalance + (rewards[i] - penalties[i]);
    if (nextBalance > 0 && nextBalance !== prevBalance) {
      epochProcess.balancesFlat[i] = nextBalance;
    }
  }

  // Note: don't set balances to the state here. See IEpochProcess JSDocs for context
  // Balances will be set to the state at once after completing the epoch transition
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
