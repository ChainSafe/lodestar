import {Deposit, Root} from "@chainsafe/lodestar-types";
import {TreeBacked, List} from "@chainsafe/ssz";
import {IDepositEvent} from "../types";
import {getTreeAtIndex} from "../../util/tree";

export function getDepositsWithProofs(
  depositEvents: IDepositEvent[],
  depositRootTree: TreeBacked<List<Root>>,
  depositCount: number
): Deposit[] {
  // Get tree at this particular depositCount to compute correct proofs
  const treeAtDepositCount = getTreeAtIndex(depositRootTree, depositCount);

  return depositEvents.map((log) => ({
    proof: treeAtDepositCount.tree().getSingleProof(treeAtDepositCount.gindexOfProperty(log.index)),
    data: log.depositData,
  }));
}
