import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconStatePhase0} from "../../types.js";
import {processDeposit as processDepositAllForks} from "../../allForks/block/index.js";

export function processDeposit(state: CachedBeaconStatePhase0, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.phase0, state, deposit);
}
