import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Deposit, Root, DepositEvent, Eth1Data, BeaconState} from "@chainsafe/lodestar-types";
import {TreeBacked, List} from "@chainsafe/ssz";
import {IFilterOptions} from "../../db";
import {getTreeAtIndex} from "../../util/tree";

export type DepositGetter<T> = (indexRange: IFilterOptions<number>, eth1Data: Eth1Data) => Promise<T[]>;

export async function getDeposits<T>(
  config: IBeaconConfig,
  // eth1_deposit_index represents the next deposit index to be added
  state: TreeBacked<BeaconState>,
  eth1Data: Eth1Data,
  depositsGetter: DepositGetter<T>
): Promise<T[]> {
  const depositIndex = state.eth1DepositIndex;
  const depositCount = eth1Data.depositCount;

  if (depositIndex > depositCount) {
    throw Error("Deposit index too high");
  }

  // Spec v0.12.2
  // assert len(body.deposits) == min(MAX_DEPOSITS, state.eth1_data.deposit_count - state.eth1_deposit_index)
  const depositsLen = Math.min(config.params.MAX_DEPOSITS, depositCount - depositIndex);

  const indexRange = {gte: depositIndex, lt: depositIndex + depositsLen};
  const deposits = await depositsGetter(indexRange, eth1Data);

  if (deposits.length < depositsLen) throw new ErrorNotEnoughDeposits(deposits.length, depositsLen);
  if (deposits.length > depositsLen) throw new ErrorTooManyDeposits(deposits.length, depositsLen);

  return deposits;
}

export function getDepositsWithProofs(
  config: IBeaconConfig,
  depositEvents: DepositEvent[],
  depositRootTree: TreeBacked<List<Root>>,
  eth1Data: Eth1Data
): Deposit[] {
  // Get tree at this particular depositCount to compute correct proofs
  const treeAtDepositCount = getTreeAtIndex(depositRootTree, eth1Data.depositCount - 1);

  const depositRoot = treeAtDepositCount.hashTreeRoot();
  if (!config.types.Root.equals(depositRoot, eth1Data.depositRoot)) {
    throw Error("Deposit root tree does not match current eth1Data");
  }

  return depositEvents.map((log) => ({
    proof: treeAtDepositCount.tree().getSingleProof(treeAtDepositCount.gindexOfProperty(log.index)),
    data: log.depositData,
  }));
}

export class ErrorNotEnoughDeposits extends Error {
  constructor(len: number, expectedLen: number) {
    super(`Not enough deposits in DB: got ${len}, expected ${expectedLen}`);
  }
}

export class ErrorTooManyDeposits extends Error {
  constructor(len: number, expectedLen: number) {
    super(`Too many deposits returned by DB: got ${len}, expected ${expectedLen}`);
  }
}
