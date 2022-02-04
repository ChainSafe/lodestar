import {
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  getCurrentSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {allForks, Root} from "@chainsafe/lodestar-types";
import {bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
import {fromHexString} from "@chainsafe/ssz";
import {IEth1ForBlockProduction, Eth1DataAndDeposits, IEth1Provider, PowMergeBlock} from "./interface";
import {Eth1DepositDataTracker, Eth1DepositDataTrackerModules} from "./eth1DepositDataTracker";
import {Eth1MergeBlockTracker, Eth1MergeBlockTrackerModules} from "./eth1MergeBlockTracker";
import {Eth1Options} from "./options";
import {Eth1Provider} from "./provider/eth1Provider";
export {IEth1ForBlockProduction, IEth1Provider, Eth1Provider};

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
  modules: Pick<Eth1DepositDataTrackerModules, "db" | "config" | "logger" | "signal">,
  anchorState: allForks.BeaconState
): IEth1ForBlockProduction {
  if (opts.enabled) {
    return new Eth1ForBlockProduction(opts, {
      config: modules.config,
      db: modules.db,
      logger: modules.logger,
      signal: modules.signal,
      clockEpoch: computeEpochAtSlot(getCurrentSlot(modules.config, anchorState.genesisTime)),
      isMergeTransitionComplete:
        bellatrix.isBellatrixStateType(anchorState) && bellatrix.isMergeTransitionComplete(anchorState),
    });
  } else {
    return new Eth1ForBlockProductionDisabled();
  }
}
export class Eth1ForBlockProduction implements IEth1ForBlockProduction {
  private readonly eth1DepositDataTracker: Eth1DepositDataTracker | null;
  private readonly eth1MergeBlockTracker: Eth1MergeBlockTracker;

  constructor(
    opts: Eth1Options,
    modules: Eth1DepositDataTrackerModules & Eth1MergeBlockTrackerModules & {eth1Provider?: IEth1Provider}
  ) {
    const eth1Provider = modules.eth1Provider || new Eth1Provider(modules.config, opts, modules.signal);

    this.eth1DepositDataTracker = opts.disableEth1DepositDataTracker
      ? null
      : new Eth1DepositDataTracker(opts, modules, eth1Provider);

    this.eth1MergeBlockTracker = new Eth1MergeBlockTracker(modules, eth1Provider);
  }

  async getEth1DataAndDeposits(state: CachedBeaconStateAllForks): Promise<Eth1DataAndDeposits> {
    if (this.eth1DepositDataTracker === null) {
      return {eth1Data: state.eth1Data, deposits: []};
    } else {
      return this.eth1DepositDataTracker.getEth1DataAndDeposits(state);
    }
  }

  getTerminalPowBlock(): Root | null {
    const block = this.eth1MergeBlockTracker.getTerminalPowBlock();
    return block && fromHexString(block.blockhash);
  }

  mergeCompleted(): void {
    this.eth1MergeBlockTracker.mergeCompleted();
  }

  getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    return this.eth1MergeBlockTracker.getPowBlock(powBlockHash);
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
  getTerminalPowBlock(): Root | null {
    return null;
  }

  mergeCompleted(): void {
    // Ignore
  }

  /** Will not be able to validate the merge block */
  async getPowBlock(): Promise<never> {
    throw Error("eth1 must be enabled to verify merge block");
  }
}
