import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Root} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {IEth1ForBlockProduction, Eth1DataAndDeposits, IEth1Provider, PowMergeBlock, TDProgress} from "./interface.js";
import {Eth1DepositDataTracker, Eth1DepositDataTrackerModules} from "./eth1DepositDataTracker.js";
import {Eth1MergeBlockTracker, Eth1MergeBlockTrackerModules} from "./eth1MergeBlockTracker.js";
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
//
// - [New bellatrix]: After BELLATRIX_FORK_EPOCH, it must fetch the block with hash
//   `state.eth1_data.block_hash` to compute `terminal_total_difficulty`. Note this may change with
//   https://github.com/ethereum/consensus-specs/issues/2603.
//
// - [New bellatrix]: On block production post BELLATRIX_FORK_EPOCH, pre merge, the beacon node must find the merge block
//   crossing the `terminal_total_difficulty` boundary and include it in the block. After the merge block production
//   will just use `execution_engine.assemble_block` without fetching individual blocks.
//
// - [New bellatrix]: Fork-choice must validate the merge block ensuring it crossed the `terminal_total_difficulty`
//   boundary, so it must fetch the POW block referenced in the merge block + its POW parent block.
//
// With the merge the beacon node has to follow the eth1 chain at two distances:
// 1. At `ETH1_FOLLOW_DISTANCE` for eth1Data to be re-org safe
// 2. At the head to get the first merge block, tolerating possible re-orgs
//
// Then both streams of blocks should not be merged since it's harder to guard against re-orgs from (2) to (1).

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
  private readonly eth1MergeBlockTracker: Eth1MergeBlockTracker;

  constructor(
    opts: Eth1Options,
    modules: Eth1DepositDataTrackerModules & Eth1MergeBlockTrackerModules & {eth1Provider?: IEth1Provider}
  ) {
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

    this.eth1MergeBlockTracker = new Eth1MergeBlockTracker(modules, eth1Provider);
  }

  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    if (this.eth1DepositDataTracker === null) {
      return {eth1Data: state.eth1Data, deposits: []};
    }
    return this.eth1DepositDataTracker.getEth1DataAndDeposits(state);
  }

  async getTerminalPowBlock(): Promise<Root | null> {
    const block = await this.eth1MergeBlockTracker.getTerminalPowBlock();
    return block && fromHex(block.blockHash);
  }

  getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    return this.eth1MergeBlockTracker.getPowBlock(powBlockHash);
  }

  getTDProgress(): TDProgress | null {
    return this.eth1MergeBlockTracker.getTDProgress();
  }

  startPollingMergeBlock(): void {
    this.eth1MergeBlockTracker.startPollingMergeBlock();
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

  startPollingMergeBlock(): void {
    // Ignore
  }

  stopPollingEth1Data(): void {
    // Ignore
  }
}
