import {ListBasicTreeViewDU, UintNumberType} from "@chainsafe/ssz";
import {IBalancesTreeCache, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Metrics} from "../metrics/index.js";
import {Epoch} from "@lodestar/types";

const MAX_ITEMS = 3;
const MIN_STATES_CACHE = 2;

export enum BalancesTreeSource {
  PRUNE_ON_FINALIZED = "pruned_on_finalized",
  IMPORT_BLOCK = "import_block",
};


/**
 * Experimental feature to reuse balances tree. Note that this is dangerous so should be disabled by default (check chain.reuseBalancesTree flag)
 * In theory, all data should be immutable, however we never read/write pre-finalized states, we can use their
 * balances tree for the next epoch transition. Some more constraints to make this safer:
 * - don't do this when node is syncing
 * - don't do this when network is not stable
 * - enforce the age of balances tree through MIN_STATES_CACHE
 * - given MAX_ITEMS = MIN_STATES_CACHE + 1, only 1 balances tree is reused at an epoch
 */
export class BalancesTreeCache implements IBalancesTreeCache {
  private readonly unusedBalancesTrees: Map<Epoch, ListBasicTreeViewDU<UintNumberType>> = new Map();

  constructor(private readonly metrics: Metrics | null = null) {
    if (metrics) {
      metrics.balancesTreeCache.size.addCollect(() => {
        metrics.balancesTreeCache.size.set(this.unusedBalancesTrees.size);
      });
    }
  }

  processUnusedState(state: CachedBeaconStateAllForks | undefined, source: BalancesTreeSource): void {
    if (state === undefined) {
      return;
    }
    const stateEpoch = state.epochCtx.epoch;
    // it's safer to reuse old balances tree
    if (this.unusedBalancesTrees.has(stateEpoch) || this.unusedBalancesTrees.size >= MAX_ITEMS) {
      return;
    }

    this.metrics?.balancesTreeCache.total.inc({source});
    this.unusedBalancesTrees.set(stateEpoch, state.balances);
  }

  getUnusedBalances(): ListBasicTreeViewDU<UintNumberType> | undefined {
    if (this.unusedBalancesTrees.size <= MIN_STATES_CACHE) {
      this.metrics?.balancesTreeCache.miss.inc();
      return undefined;
    }

    this.metrics?.balancesTreeCache.hit.inc();
    const firstEpoch = Array.from(this.unusedBalancesTrees.keys())[0];
    const unusedBalances = this.unusedBalancesTrees.get(firstEpoch);
    this.unusedBalancesTrees.delete(firstEpoch);
    return unusedBalances;
  }
}
