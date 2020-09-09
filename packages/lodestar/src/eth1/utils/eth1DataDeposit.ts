import {Root} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {getTreeAtIndex} from "../../util/tree";
import {groupDepositEventsByBlock} from "./groupDepositEventsByBlock";
import {IEth1DataDeposit, IEth1Block, IEth1DataWithBlock} from "../types";

/**
 * Extract partial eth1 data (depositRoot, depositCount) from downloaded deposits
 * Last deposit per block
 *
 * Store as
 * blockNumber - depositCount - depositRoot
 * 1034          456            0x1256a1
 * ---- (non consecutive blocks, blocks without deposits)
 * 1030          450            0x08821b
 * 1029          448            0x66d411
 *
 * Read as: for blockNumber, retrieve first partial eth1Data that is equal or less than blockNumber
 * MUST store and check lastProcessedBlockNumber to prevent returning incorrect old data
 */
export function getEth1DataDepositFromDeposits(
  depositRoots: {index: number; root: Uint8Array; blockNumber: number}[],
  depositRootTreeFull: TreeBacked<List<Root>>
): IEth1DataDeposit[] {
  if (depositRoots.length === 0) return [];

  const previousIndex = depositRoots[0].index - 1;
  const depositRootTree = getTreeAtIndex(depositRootTreeFull, previousIndex);

  return groupDepositEventsByBlock(depositRoots).map(
    ([blockNumber, depositRootsByBlock]): IEth1DataDeposit => {
      for (const depositRoot of depositRootsByBlock) {
        depositRootTree.push(depositRoot.root);
      }
      return {
        blockNumber,
        depositRoot: depositRootTree.hashTreeRoot(),
        depositCount: depositRootTree.length,
      };
    }
  );
}

/**
 * Performs a backfill on sparse Eth1DataDeposit data.
 * Assumes that for blockNumber N, its depositRoot,depositCount is equal to the previous nearest
 * available data with blockNumber < N.
 */
export function mapEth1DataDepositToBlockRange(
  fromBlock: number,
  toBlock: number,
  eth1Datas: IEth1DataDeposit[]
): {[blockNumber: number]: IEth1DataDeposit} {
  if (eth1Datas.length === 0) {
    throw Error("eth1Data array is empty");
  }

  const lowestBlockNumber = eth1Datas[0].blockNumber;
  const highestBlockNumber = eth1Datas[eth1Datas.length - 1].blockNumber;
  if (fromBlock < lowestBlockNumber) {
    throw Error(
      `Not enough eth1Data available for range [${fromBlock}, ${toBlock}], provided: [${lowestBlockNumber}, ${highestBlockNumber}]`
    );
  }

  const eth1DataDepositMap: {[blockNumber: number]: IEth1DataDeposit} = {};

  let pointer = 0;
  for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber++) {
    for (let i = pointer; i < eth1Datas.length; i++) {
      if (
        i === eth1Datas.length - 1 ||
        (eth1Datas[i].blockNumber <= blockNumber && eth1Datas[i + 1].blockNumber > blockNumber)
      ) {
        eth1DataDepositMap[blockNumber] = eth1Datas[i];
        pointer = i;
        break;
      }
    }
  }

  return eth1DataDepositMap;
}

/**
 * Appends partial eth1 data (depositRoot, depositCount) in a sequence of blocks
 * eth1 data deposit is inferred from sparse eth1 data obtained from the deposit logs
 */
export async function appendEth1DataDeposit(
  blocks: IEth1Block[],
  eth1DataDepositDescendingStream: AsyncIterable<IEth1DataDeposit>,
  lastProcessedDepositBlockNumber?: number
): Promise<IEth1DataWithBlock[]> {
  // Exclude blocks for which there is no valid eth1 data deposit
  if (lastProcessedDepositBlockNumber) {
    blocks = blocks.filter((block) => block.number <= lastProcessedDepositBlockNumber);
  }

  // A valid block can be constructed using previous `state.eth1Data`, don't throw
  if (blocks.length === 0) {
    return [];
  }

  const fromBlock = blocks[0].number;
  const toBlock = blocks[blocks.length - 1].number;

  // Take blocks until the block under the range lower bound (included)
  const eth1DatasDeposit: IEth1DataDeposit[] = [];
  for await (const eth1DataBlock of eth1DataDepositDescendingStream) {
    eth1DatasDeposit.push(eth1DataBlock);
    if (eth1DataBlock.blockNumber < fromBlock) break;
  }

  // Convert sparse eth1 data deposit into consecutive
  const eth1DataDepositMap = mapEth1DataDepositToBlockRange(fromBlock, toBlock, eth1DatasDeposit.reverse());

  return blocks.map((block) => ({
    blockHash: block.hash,
    depositCount: eth1DataDepositMap[block.number]?.depositCount,
    depositRoot: eth1DataDepositMap[block.number]?.depositRoot,
    blockNumber: block.number,
    timestamp: block.timestamp,
  }));
}
