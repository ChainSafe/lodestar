import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Root} from "@lodestar/types";
import {Eth1DataAndDeposits, IEth1ForBlockProduction, PowMergeBlock, TDProgress} from "./interface.js";

/**
 * Disabled version of Eth1ForBlockProduction
 * May produce invalid blocks by not adding new deposits and voting for the same eth1Data
 */
export class Eth1ForBlockProductionDisabled implements IEth1ForBlockProduction {
  /**
   * Returns same eth1Data as in state and no deposits
   * May produce invalid blocks if deposits have to be added
   */
  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    return {eth1Data: state.eth1Data, deposits: []};
  }

  /**
   * Will miss the oportunity to propose the merge block but will still produce valid blocks
   */
  async getTerminalPowBlock(): Promise<Root | null> {
    return null;
  }

  /** Will not be able to validate the merge block */
  async getPowBlock(_powBlockHash: string): Promise<PowMergeBlock | null> {
    throw Error("eth1 must be enabled to verify merge block");
  }

  getTDProgress(): TDProgress | null {
    return null;
  }

  isPollingEth1Data(): boolean {
    return false;
  }

  startPollingMergeBlock(): void {
    // Ignore
  }

  stopPollingEth1Data(): void {
    // Ignore
  }
}
