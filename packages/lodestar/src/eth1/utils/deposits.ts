import {Deposit, Root} from "@chainsafe/lodestar-types";
import {TreeBacked, List} from "@chainsafe/ssz";
import {IDepositEvent} from "../types";
import {getTreeAtIndex} from "../../util/tree";

/**
 * Returns a Deposit array with proofs computed at `depositCount`
 * `depositRootTree` must already include the roots of the deposits
 */
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
