import {Root, Eth1Data, DepositEvent, Eth1Block} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {getTreeAtIndex} from "../../util/tree";
import {backfillMap} from "../../util/map";

/**
 * Appends partial eth1 data (depositRoot, depositCount) in a sequence of blocks
 * eth1 data deposit is inferred from sparse eth1 data obtained from the deposit logs
 */
export async function appendEth1DataDeposit(
  blocks: Eth1Block[],
  depositDescendingStream: AsyncIterable<DepositEvent>,
  depositRootTree: TreeBacked<List<Root>>,
  lastProcessedDepositBlockNumber: number | null
): Promise<(Eth1Data & Eth1Block)[]> {
  // Exclude blocks for which there is no valid eth1 data deposit
  if (lastProcessedDepositBlockNumber) {
    blocks = blocks.filter((block) => block.blockNumber <= lastProcessedDepositBlockNumber);
  }

  // A valid block can be constructed using previous `state.eth1Data`, don't throw
  if (blocks.length === 0) {
    return [];
  }

  // Generate a map of blockNumber => depositCount (from stored deposits)
  const fromBlock = blocks[0].blockNumber;
  const toBlock = blocks[blocks.length - 1].blockNumber;
  const depositCountByBlockNumber = await getDepositCountByBlockNumber(fromBlock, toBlock, depositDescendingStream);

  // Generate a map of depositCount => depositRoot (from depositRootTree)
  const depositCounts = Array.from(depositCountByBlockNumber.values());
  const depositRootByDepositCount = getDepositRootByDepositCount(depositCounts, depositRootTree);

  const eth1Datas: (Eth1Data & Eth1Block)[] = [];
  for (const block of blocks) {
    const depositCount = depositCountByBlockNumber.get(block.blockNumber);
    if (depositCount === undefined) throw new ErrorNoDepositCount(block.blockNumber);
    const depositRoot = depositRootByDepositCount.get(depositCount);
    if (depositRoot === undefined) throw new ErrorNoDepositRoot(depositCount);
    eth1Datas.push({...block, depositCount, depositRoot});
  }
  return eth1Datas;
}

/**
 * Precompute a map of blockNumber => depositCount from a stream of descending deposits
 * For a given blockNumber it's depositCount is equal to the index + 1 of the
 * closest deposit event whose deposit.blockNumber <= blockNumber
 */
export async function getDepositCountByBlockNumber(
  fromBlock: number,
  toBlock: number,
  depositEventDescendingStream: AsyncIterable<DepositEvent>
): Promise<Map<number, number>> {
  const depositCountMap = new Map<number, number>();
  // Take blocks until the block under the range lower bound (included)
  for await (const {blockNumber, index} of depositEventDescendingStream) {
    if (blockNumber <= toBlock && !depositCountMap.has(index)) {
      depositCountMap.set(blockNumber, index + 1);
    }
    if (blockNumber < fromBlock) {
      break;
    }
  }
  return backfillMap(depositCountMap, toBlock);
}

/**
 * Precompute a map of depositCount => depositRoot from a depositRootTree filled beforehand
 */
export function getDepositRootByDepositCount(
  depositCounts: number[],
  depositRootTree: TreeBacked<List<Root>>
): Map<number, Root> {
  // Unique + sort numerically in descending order
  depositCounts = [...new Set(depositCounts)].sort((a, b) => b - a);

  if (depositCounts.length > 0) {
    const maxIndex = depositCounts[0] - 1;
    const treeLength = depositRootTree.length - 1;
    if (maxIndex > treeLength) {
      throw new ErrorNotEnoughDepositRoots(maxIndex, treeLength);
    }
  }

  return depositCounts.reduce((map: Map<number, Root>, depositCount) => {
    depositRootTree = getTreeAtIndex(depositRootTree, depositCount - 1);
    map.set(depositCount, depositRootTree.hashTreeRoot());
    return map;
  }, new Map());
}

export class ErrorNoDepositCount extends Error {
  blockNumber: number;
  constructor(blockNumber: number) {
    super(`No depositCount for blockNumber ${blockNumber}`);
    this.blockNumber = blockNumber;
  }
}

export class ErrorNoDepositRoot extends Error {
  depositCount: number;
  constructor(depositCount: number) {
    super(`No depositRoot for depositCount ${depositCount}`);
    this.depositCount = depositCount;
  }
}

export class ErrorNotEnoughDepositRoots extends Error {
  index: number;
  treeLength: number;
  constructor(index: number, treeLength: number) {
    super(`Not enough deposit roots for index ${index}, current length ${treeLength}`);
    this.index = index;
    this.treeLength = treeLength;
  }
}
