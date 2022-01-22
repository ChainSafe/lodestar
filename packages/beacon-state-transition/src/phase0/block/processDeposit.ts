import {phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconStatePhase0, CachedBeaconStateAllForks} from "../../types";
import {processDeposit as processDepositAllForks} from "../../allForks/block";

export function processDeposit(state: CachedBeaconStatePhase0, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.phase0, state as CachedBeaconStateAllForks, deposit);
}
