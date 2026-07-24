import {ChainForkConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {EffectiveBalanceIncrements, IBeaconStateView, computeCheckpointSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/** The number of validator balance sets that are cached within `CheckpointBalancesCache`. */
const MAX_BALANCE_CACHE_SIZE = 4;

type BalancesCacheItem = {
  rootHex: RootHex;
  epoch: Epoch;
  balances: EffectiveBalanceIncrements;
};

/**
 * Cache EffectiveBalanceIncrements of checkpoint blocks
 */
export class CheckpointBalancesCache {
  private readonly items: BalancesCacheItem[] = [];

  constructor(private readonly config: ChainForkConfig) {}

  /**
   * Inspect the given `state` and determine the root of the checkpoint block of `state.epoch`.
   * If there is not already some entry for the given block root, then add the effective balances
   * from the `state` to the cache.
   *
   * Post EIP-8333 the checkpoint block is the last block of the previous epoch, so all branches
   * sharing that block resolve to a single entry instead of one entry per first-slot block.
   */
  processState(blockRootHex: RootHex, state: IBeaconStateView): void {
    const epoch = state.epoch;
    const checkpointSlot = computeCheckpointSlotAtEpoch(this.config, epoch);
    const checkpointRoot =
      checkpointSlot === state.slot ? blockRootHex : toRootHex(state.getBlockRootAtSlot(checkpointSlot));

    const index = this.items.findIndex((item) => item.epoch === epoch && item.rootHex === checkpointRoot);
    if (index === -1) {
      if (this.items.length === MAX_BALANCE_CACHE_SIZE) {
        this.items.shift();
      }
      // expect to reach this once per epoch
      this.items.push({epoch, rootHex: checkpointRoot, balances: state.getEffectiveBalanceIncrementsZeroInactive()});
    }
  }

  get(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements | undefined {
    const {rootHex, epoch} = checkpoint;
    return this.items.find((item) => item.epoch === epoch && item.rootHex === rootHex)?.balances;
  }
}
