import {ListBasicTreeViewDU, UintNumberType} from "@chainsafe/ssz";
import {IBalancesTreeCache, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Metrics} from "../metrics/index.js";
import {Epoch} from "@lodestar/types";

const MAX_ITEMS = 2;

export enum BalancesTreeSource {
  PRUNE_ON_FINALIZED = "pruned_on_finalized",
  IMPORT_BLOCK = "import_block",
};

/**
 * A cached of unused balances tree
 * States in the same epoch share the same balances tree so we only want to cache max once per epoch
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
    if (this.unusedBalancesTrees.has(stateEpoch)) {
      return;
    }

    this.metrics?.balancesTreeCache.total.inc({source});

    this.unusedBalancesTrees.set(stateEpoch, state.balances);
    while (this.unusedBalancesTrees.size > MAX_ITEMS) {
      const firstEpoch = Array.from(this.unusedBalancesTrees.keys())[0];
      this.unusedBalancesTrees.delete(firstEpoch);
    }
  }

  getUnusedBalances(): ListBasicTreeViewDU<UintNumberType> | undefined {
    if (this.unusedBalancesTrees.size === 0) {
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
