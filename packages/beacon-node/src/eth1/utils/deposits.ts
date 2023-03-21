import {MAX_DEPOSITS} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {toGindex, Tree} from "@chainsafe/persistent-merkle-tree";
import {toHexString} from "@chainsafe/ssz";
import {FilterOptions} from "@lodestar/db";
import {Eth1Error, Eth1ErrorCode} from "../errors.js";
import {DepositTree} from "../../db/repositories/depositDataRoot.js";

export type DepositGetter<T> = (indexRange: FilterOptions<number>, eth1Data: phase0.Eth1Data) => Promise<T[]>;

export async function getDeposits<T>(
  // eth1_deposit_index represents the next deposit index to be added
  state: BeaconStateAllForks,
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
  depositRootTree: DepositTree,
  eth1Data: phase0.Eth1Data
): phase0.Deposit[] {
  // Get tree at this particular depositCount to compute correct proofs
  const viewAtDepositCount = depositRootTree.sliceTo(eth1Data.depositCount - 1);

  const depositRoot = viewAtDepositCount.hashTreeRoot();

  if (!ssz.Root.equals(depositRoot, eth1Data.depositRoot)) {
    throw new Eth1Error({
      code: Eth1ErrorCode.WRONG_DEPOSIT_ROOT,
      root: toHexString(depositRoot),
      expectedRoot: toHexString(eth1Data.depositRoot),
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
