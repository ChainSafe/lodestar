import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {BeaconStateCachedPhase0, BeaconStateCachedAllForks} from "../../allForks/util";
import {processDeposit as processDepositAllForks} from "../../allForks/block";

export function processDeposit(state: BeaconStateCachedPhase0, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.phase0, state as BeaconStateCachedAllForks, deposit);
}
