import {ForkName} from "@chainsafe/lodestar-params";
import {processRewardsAndPenaltiesAllForks} from "../../allForks/epoch/processRewardsAndPenalties";
import {CachedBeaconStatePhase0, CachedBeaconStateAllForks, EpochProcess} from "../../types";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags
 * are true, worst case: FLAG_UNSLASHED + FLAG_ELIGIBLE_ATTESTER + FLAG_PREV_*
 */
export function processRewardsAndPenalties(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): void {
  processRewardsAndPenaltiesAllForks(ForkName.phase0, state as CachedBeaconStateAllForks, epochProcess);
}
