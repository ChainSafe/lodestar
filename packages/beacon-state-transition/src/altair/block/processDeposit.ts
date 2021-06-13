import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

import {CachedBeaconState} from "../../allForks/util";
import {processDepositAllForks} from "../../phase0/block/processDeposit";

export function processDeposit(state: CachedBeaconState<altair.BeaconState>, deposit: phase0.Deposit): void {
  processDepositAllForks(ForkName.altair, state as CachedBeaconState<allForks.BeaconState>, deposit);
}
