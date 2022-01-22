import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {BeaconStateCachedAltair, BeaconStateCachedAllForks} from "../../types";
import {processDeposit as processDepositAllForks} from "../../allForks/block";

export function processDeposit(state: BeaconStateCachedAltair, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.altair, state as BeaconStateCachedAllForks, deposit);
}
