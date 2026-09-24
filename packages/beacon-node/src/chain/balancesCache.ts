import {CheckpointWithHex, JustifiedBalancesWithTotal} from "@lodestar/fork-choice";
import {IBeaconStateView, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";

/** The number of validator balance sets that are cached within `CheckpointBalancesCache`. */
const MAX_BALANCE_CACHE_SIZE = 4;

type BalancesCacheItem = {
  rootHex: RootHex;
  epoch: Epoch;
  justifiedBalances: JustifiedBalancesWithTotal;
};

export function getJustifiedBalances(state: IBeaconStateView): JustifiedBalancesWithTotal {
  const {effectiveBalanceIncrements} = state;
  let totalBalance = 0;
  for (const index of state.getCurrentShuffling().activeIndices) {
    totalBalance += effectiveBalanceIncrements[index];
  }
  return {balances: state.getEffectiveBalanceIncrementsZeroInactive(), totalBalance};
}

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
  processState(blockRootHex: RootHex, state: IBeaconStateView): void {
    const epoch = state.epoch;
    const epochBoundarySlot = computeStartSlotAtEpoch(epoch);
    const epochBoundaryRoot =
      epochBoundarySlot === state.slot ? blockRootHex : toRootHex(state.getBlockRootAtSlot(epochBoundarySlot));

    const index = this.items.findIndex((item) => item.epoch === epoch && item.rootHex === epochBoundaryRoot);
    if (index === -1) {
      if (this.items.length === MAX_BALANCE_CACHE_SIZE) {
        this.items.shift();
      }
      // expect to reach this once per epoch
      this.items.push({epoch, rootHex: epochBoundaryRoot, justifiedBalances: getJustifiedBalances(state)});
    }
  }

  get(checkpoint: CheckpointWithHex): JustifiedBalancesWithTotal | undefined {
    const {rootHex, epoch} = checkpoint;
    return this.items.find((item) => item.epoch === epoch && item.rootHex === rootHex)?.justifiedBalances;
  }
}
