import {ListBasicTreeViewDU, UintNumberType} from "@chainsafe/ssz";
import {IBalancesTreeCache, CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {Metrics} from "../metrics/index.js";

const MAX_ITEMS = 2;

export class BalancesTreeCache implements IBalancesTreeCache {
  private readonly unusedBalancesTrees: ListBasicTreeViewDU<UintNumberType>[] = [];

  constructor(private readonly metrics: Metrics | null = null) {
    if (metrics) {
      metrics.balancesTreeCache.size.addCollect(() => {
        metrics.balancesTreeCache.size.set(this.unusedBalancesTrees.length);
      });
    }
  }

  processUnusedState(state: CachedBeaconStateAllForks | undefined): void {
    if (state === undefined) {
      return;
    }

    this.unusedBalancesTrees.push(state.balances);
    while (this.unusedBalancesTrees.length > MAX_ITEMS) {
      this.unusedBalancesTrees.shift();
    }
  }

  getUnusedBalances(): ListBasicTreeViewDU<UintNumberType> | undefined {
    if (this.unusedBalancesTrees.length === 0) {
      this.metrics?.balancesTreeCache.miss.inc();
      return undefined;
    }

    this.metrics?.balancesTreeCache.hit.inc();
    return this.unusedBalancesTrees.shift();
  }
}
