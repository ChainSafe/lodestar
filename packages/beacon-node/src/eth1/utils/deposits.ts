import {toGindex, Tree} from "@chainsafe/persistent-merkle-tree";
import {toRootHex} from "@lodestar/utils";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {FilterOptions} from "@lodestar/db";
import {getEth1DepositCount} from "@lodestar/state-transition";
import {Eth1Error, Eth1ErrorCode} from "../errors.js";
import {DepositTree} from "../../db/repositories/depositDataRoot.js";

export type DepositGetter<T> = (indexRange: FilterOptions<number>, eth1Data: phase0.Eth1Data) => Promise<T[]>;

export async function getDeposits<T>(
  // eth1_deposit_index represents the next deposit index to be added
  state: CachedBeaconStateAllForks,
  eth1Data: phase0.Eth1Data,
  depositsGetter: DepositGetter<T>
): Promise<T[]> {
  const depositIndex = state.eth1DepositIndex;
  const depositCount = eth1Data.depositCount;

  if (depositIndex > depositCount) {
    throw new Eth1Error({code: Eth1ErrorCode.DEPOSIT_INDEX_TOO_HIGH, depositIndex, depositCount});
  }

  const depositsLen = getEth1DepositCount(state, eth1Data);

  if (depositsLen === 0) {
    return []; // If depositsLen === 0, we can return early since no deposit with be returned from depositsGetter
  }

  const indexRange = {gte: depositIndex, lt: depositIndex + depositsLen};
  const deposits = await depositsGetter(indexRange, eth1Data);

  if (deposits.length < depositsLen) {
    throw new Eth1Error({code: Eth1ErrorCode.NOT_ENOUGH_DEPOSITS, len: deposits.length, expectedLen: depositsLen});
  }

  if (deposits.length > depositsLen) {
    throw new Eth1Error({code: Eth1ErrorCode.TOO_MANY_DEPOSITS, len: deposits.length, expectedLen: depositsLen});
  }

  return deposits;
}

export function getDepositsWithProofs(
  depositEvents: phase0.DepositEvent[],
  depositRootTree: DepositTree,
  eth1Data: phase0.Eth1Data
): phase0.Deposit[] {
  // Get tree at this particular depositCount to compute correct proofs
  const viewAtDepositCount = depositRootTree.sliceTo(eth1Data.depositCount - 1);

  const depositRoot = viewAtDepositCount.hashTreeRoot();

  if (!ssz.Root.equals(depositRoot, eth1Data.depositRoot)) {
    throw new Eth1Error({
      code: Eth1ErrorCode.WRONG_DEPOSIT_ROOT,
      root: toRootHex(depositRoot),
      expectedRoot: toRootHex(eth1Data.depositRoot),
    });
  }

  // Already commited for .hashTreeRoot()
  const treeAtDepositCount = new Tree(viewAtDepositCount.node);
  const depositTreeDepth = viewAtDepositCount.type.depth;

  return depositEvents.map((log) => ({
    proof: treeAtDepositCount.getSingleProof(toGindex(depositTreeDepth, BigInt(log.index))),
    data: log.depositData,
  }));
}
