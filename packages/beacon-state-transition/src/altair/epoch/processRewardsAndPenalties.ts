import {CachedBeaconStateAltair, CachedBeaconStateAllForks, EpochProcess} from "../../types";
import {ForkName} from "@chainsafe/lodestar-params";
import {processRewardsAndPenaltiesAllForks} from "../../allForks/epoch/processRewardsAndPenalties";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags
 * are true, worst case: FLAG_UNSLASHED + FLAG_ELIGIBLE_ATTESTER + FLAG_PREV_*
 */
export function processRewardsAndPenalties(state: CachedBeaconStateAltair, epochProcess: EpochProcess): void {
  processRewardsAndPenaltiesAllForks(ForkName.altair, state as CachedBeaconStateAllForks, epochProcess);
}
