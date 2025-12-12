import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Eth1DepositDataTracker, Eth1DepositDataTrackerModules} from "./eth1DepositDataTracker.js";
import {Eth1DataAndDeposits, IEth1ForBlockProduction, IEth1Provider} from "./interface.js";
import {Eth1Options} from "./options.js";
import {Eth1Provider} from "./provider/eth1Provider.js";
export {Eth1Provider};
export type {IEth1ForBlockProduction, IEth1Provider};

// This module encapsulates all consumer functionality to the execution node (formerly eth1). The execution client
// has to:
//
// - For genesis, the beacon node must follow the eth1 chain: get all deposit events + blocks within that range.
//   Once the genesis conditions are met, start the POS chain with the resulting state. The logic is similar to the
//   two points below, but the implementation is specialized for each scenario.
//
// - Follow the eth1 block chain to validate eth1Data votes. It needs all consecutive blocks within a specific range
//   and at a distance from the head.
//   ETH1_FOLLOW_DISTANCE 	        uint64(2**11) (= 2,048) 	Eth1 blocks 	~8 hours
//   EPOCHS_PER_ETH1_VOTING_PERIOD 	uint64(2**6) (= 64)     	epochs 	      ~6.8 hours
//
// - Fetch ALL deposit events from the deposit contract to build the deposit tree and validate future merkle proofs.
//   Then it must follow deposit events at a distance roughly similar to the `ETH1_FOLLOW_DISTANCE` parameter above.

export function initializeEth1ForBlockProduction(
  opts: Eth1Options,
  modules: Pick<Eth1DepositDataTrackerModules, "db" | "config" | "metrics" | "logger" | "signal">
): IEth1ForBlockProduction {
  if (opts.enabled) {
    return new Eth1ForBlockProduction(opts, {
      config: modules.config,
      db: modules.db,
      metrics: modules.metrics,
      logger: modules.logger,
      signal: modules.signal,
    });
  }
  return new Eth1ForBlockProductionDisabled();
}

export class Eth1ForBlockProduction implements IEth1ForBlockProduction {
  private readonly eth1DepositDataTracker: Eth1DepositDataTracker | null;

  constructor(opts: Eth1Options, modules: Eth1DepositDataTrackerModules & {eth1Provider?: IEth1Provider}) {
    const eth1Provider =
      modules.eth1Provider ||
      new Eth1Provider(
        modules.config,
        {...opts, logger: modules.logger},
        modules.signal,
        modules.metrics?.eth1HttpClient
      );

    this.eth1DepositDataTracker = opts.disableEth1DepositDataTracker
      ? null
      : new Eth1DepositDataTracker(opts, modules, eth1Provider);
  }

  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    if (this.eth1DepositDataTracker === null) {
      return {eth1Data: state.eth1Data, deposits: []};
    }
    return this.eth1DepositDataTracker.getEth1DataAndDeposits(state);
  }

  isPollingEth1Data(): boolean {
    return this.eth1DepositDataTracker?.isPollingEth1Data() ?? false;
  }

  stopPollingEth1Data(): void {
    this.eth1DepositDataTracker?.stopPollingEth1Data();
  }
}

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

  isPollingEth1Data(): boolean {
    return false;
  }

  stopPollingEth1Data(): void {
    // Ignore
  }
}
