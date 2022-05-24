import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconStateAltair} from "../../types.js";
import {processDeposit as processDepositAllForks} from "../../allForks/block/index.js";

export function processDeposit(state: CachedBeaconStateAltair, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.altair, state, deposit);
}
