import {ForkName} from "@chainsafe/lodestar-params";
import {processRewardsAndPenaltiesAllForks} from "../../allForks/epoch/processRewardsAndPenalties";
import {CachedBeaconStatePhase0, EpochProcess} from "../../types";

/**
 * Iterate over all validator and compute rewards and penalties to apply to balances.
 *
 * PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags are set
 */
export function processRewardsAndPenalties(state: CachedBeaconStatePhase0, epochProcess: EpochProcess): void {
  processRewardsAndPenaltiesAllForks(ForkName.phase0, state, epochProcess);
}
