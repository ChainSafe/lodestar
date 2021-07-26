import {MAX_DEPOSITS} from "@chainsafe/lodestar-params";
import {Root, phase0, allForks, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked, List, toHexString} from "@chainsafe/ssz";
import {IFilterOptions} from "@chainsafe/lodestar-db";
import {getTreeAtIndex} from "../../util/tree";
import {Eth1Error, Eth1ErrorCode} from "../errors";

export type DepositGetter<T> = (indexRange: IFilterOptions<number>, eth1Data: phase0.Eth1Data) => Promise<T[]>;

export async function getDeposits<T>(
  // eth1_deposit_index represents the next deposit index to be added
  state: allForks.BeaconState,
  eth1Data: phase0.Eth1Data,
  depositsGetter: DepositGetter<T>
): Promise<T[]> {
  const depositIndex = state.eth1DepositIndex;
  const depositCount = eth1Data.depositCount;

  if (depositIndex > depositCount) {
    throw new Eth1Error({code: Eth1ErrorCode.DEPOSIT_INDEX_TOO_HIGH, depositIndex, depositCount});
  }

  // Spec v0.12.2
  // assert len(body.deposits) == min(MAX_DEPOSITS, state.eth1_data.deposit_count - state.eth1_deposit_index)
  const depositsLen = Math.min(MAX_DEPOSITS, depositCount - depositIndex);

  const indexRange = {gte: depositIndex, lt: depositIndex + depositsLen};
  const deposits = await depositsGetter(indexRange, eth1Data);

  if (deposits.length < depositsLen) {
    throw new Eth1Error({code: Eth1ErrorCode.NOT_ENOUGH_DEPOSITS, len: deposits.length, expectedLen: depositsLen});
  } else if (deposits.length > depositsLen) {
    throw new Eth1Error({code: Eth1ErrorCode.TOO_MANY_DEPOSITS, len: deposits.length, expectedLen: depositsLen});
  }

  return deposits;
}

export function getDepositsWithProofs(
  depositEvents: phase0.DepositEvent[],
  depositRootTree: TreeBacked<List<Root>>,
  eth1Data: phase0.Eth1Data
): phase0.Deposit[] {
  // Get tree at this particular depositCount to compute correct proofs
  const treeAtDepositCount = getTreeAtIndex(depositRootTree, eth1Data.depositCount - 1);

  const depositRoot = treeAtDepositCount.hashTreeRoot();

  if (!ssz.Root.equals(depositRoot, eth1Data.depositRoot)) {
    throw new Eth1Error({
      code: Eth1ErrorCode.WRONG_DEPOSIT_ROOT,
      root: toHexString(depositRoot),
      expectedRoot: toHexString(eth1Data.depositRoot),
    });
  }

  return depositEvents.map((log) => ({
    proof: treeAtDepositCount.tree.getSingleProof(treeAtDepositCount.type.getPropertyGindex(log.index)),
    data: log.depositData,
  }));
}
