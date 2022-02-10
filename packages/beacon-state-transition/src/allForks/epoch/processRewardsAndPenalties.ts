import {CachedBeaconStateAltair, CachedBeaconStatePhase0, CachedBeaconStateAllForks, EpochProcess} from "../../types";
import {ForkName, GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {getAttestationDeltas as getAttestationDeltasPhase0} from "../../phase0/epoch/getAttestationDeltas";
import {getRewardsAndPenalties as getRewardsPenaltiesAltair} from "../../altair/epoch/getRewardsAndPenalties";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags
 * are true, worst case: FLAG_UNSLASHED + FLAG_ELIGIBLE_ATTESTER + FLAG_PREV_*
 */
export function processRewardsAndPenaltiesAllForks<T extends CachedBeaconStateAllForks>(
  fork: ForkName,
  state: T,
  epochProcess: EpochProcess
): void {
  // No rewards are applied at the end of `GENESIS_EPOCH` because rewards are for work done in the previous epoch
  if (epochProcess.currentEpoch === GENESIS_EPOCH) {
    return;
  }

  const [rewards, penalties] =
    fork === ForkName.phase0
      ? getAttestationDeltasPhase0(state as CachedBeaconStatePhase0, epochProcess)
      : getRewardsPenaltiesAltair(state as CachedBeaconStateAltair, epochProcess);

  const deltas: number[] = [];
  for (let i = 0, len = rewards.length; i < len; i++) {
    deltas.push(rewards[i] - penalties[i]);
  }

  // important: do not change state one balance at a time
  // set them all at once, constructing the tree in one go
  // cache the balances array, too
  epochProcess.balances = state.balanceList.updateAll(deltas);
}
