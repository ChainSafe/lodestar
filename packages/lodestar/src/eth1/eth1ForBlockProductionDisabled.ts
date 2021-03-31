import {allForks, phase0} from "@chainsafe/lodestar-types";
import {IEth1ForBlockProduction} from "./interface";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

/**
 * Disabled version of Eth1ForBlockProduction
 * May produce invalid blocks by not adding new deposits and voting for the same eth1Data
 */
export class Eth1ForBlockProductionDisabled implements IEth1ForBlockProduction {
  /**
   * Returns same eth1Data as in state and no deposits
   * May produce invalid blocks if deposits have to be added
   */
  async getEth1DataAndDeposits(
    state: CachedBeaconState<allForks.BeaconState>
  ): Promise<{
    eth1Data: phase0.Eth1Data;
    deposits: phase0.Deposit[];
  }> {
    return {eth1Data: state.eth1Data, deposits: []};
  }
}
