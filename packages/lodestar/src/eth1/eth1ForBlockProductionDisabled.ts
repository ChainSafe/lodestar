import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Eth1Data, Deposit} from "@chainsafe/lodestar-types";
import {IEth1ForBlockProduction} from "./interface";

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
    state: TreeBacked<BeaconState>
  ): Promise<{
    eth1Data: Eth1Data;
    deposits: Deposit[];
  }> {
    return {eth1Data: state.eth1Data, deposits: []};
  }
}
