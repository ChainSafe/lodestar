import {allForks, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconState} from "../../allForks/util";
import {processDeposit as processDepositAllForks} from "../../allForks/block";

export function processDeposit(state: CachedBeaconState<phase0.BeaconState>, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.phase0, state as CachedBeaconState<allForks.BeaconState>, deposit);
}
