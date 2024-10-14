import {
  CachedBeaconStateAllForks,
  computeStartSlotAtEpoch,
  EffectiveBalanceIncrements,
  getBlockRootAtSlot,
  getEffectiveBalanceIncrementsZeroInactive,
} from "@lodestar/state-transition";
import {CheckpointWithHex} from "@lodestar/fork-choice";
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

  /**
   * Inspect the given `state` and determine the root of the block at the first slot of
   * `state.current_epoch`. If there is not already some entry for the given block root, then
   * add the effective balances from the `state` to the cache.
   */
  processState(blockRootHex: RootHex, state: CachedBeaconStateAllForks): void {
    const epoch = state.epochCtx.epoch;
    const epochBoundarySlot = computeStartSlotAtEpoch(epoch);
    const epochBoundaryRoot =
      epochBoundarySlot === state.slot ? blockRootHex : toRootHex(getBlockRootAtSlot(state, epochBoundarySlot));

    const index = this.items.findIndex((item) => item.epoch === epoch && item.rootHex === epochBoundaryRoot);
    if (index === -1) {
      if (this.items.length === MAX_BALANCE_CACHE_SIZE) {
        this.items.shift();
      }
      // expect to reach this once per epoch
      this.items.push({epoch, rootHex: epochBoundaryRoot, balances: getEffectiveBalanceIncrementsZeroInactive(state)});
    }
  }

  get(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements | undefined {
    const {rootHex, epoch} = checkpoint;
    return this.items.find((item) => item.epoch === epoch && item.rootHex === rootHex)?.balances;
  }
}
