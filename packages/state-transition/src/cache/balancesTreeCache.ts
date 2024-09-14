import {UintNumberType, ListBasicTreeViewDU} from "@chainsafe/ssz";

export interface IBalancesTreeCache {
  getUnusedBalances(): ListBasicTreeViewDU<UintNumberType> | undefined;
}
