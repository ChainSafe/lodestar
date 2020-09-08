import {Root} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {getTreeAtIndex} from "../../util/tree";
import {groupDepositEventsByBlock} from "./groupDepositEventsByBlock";
import {IEth1DataDeposit} from "../types";

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
 * @param fromBlock
 * @param toBlock
 * @param eth1DataDepositArr
 */
export function fillEth1DataDepositToBlockRange(
  fromBlock: number,
  toBlock: number,
  eth1DataDepositArr: IEth1DataDeposit[]
): IEth1DataDeposit[] {
  if (eth1DataDepositArr.length === 0) {
    throw Error("eth1Data array is empty");
  }

  const lowestBlockNumber = eth1DataDepositArr[0].blockNumber;
  const highestBlockNumber = eth1DataDepositArr[eth1DataDepositArr.length - 1].blockNumber;
  if (fromBlock < lowestBlockNumber || toBlock > highestBlockNumber) {
    throw Error(
      `Not enough eth1Data available for range [${fromBlock}, ${toBlock}], provided: [${lowestBlockNumber}, ${highestBlockNumber}]`
    );
  }

  const eth1DataDepositArrSeq: IEth1DataDeposit[] = [];
  for (let i = 0; i < eth1DataDepositArr.length - 1; i++) {
    const fromEth1Data = eth1DataDepositArr[i];
    const toEth1Data = eth1DataDepositArr[i + 1];

    for (let blockNumber = fromEth1Data.blockNumber; blockNumber < toEth1Data.blockNumber; blockNumber++) {
      eth1DataDepositArrSeq.push({
        blockNumber,
        depositRoot: eth1DataDepositArr[i].depositRoot,
        depositCount: eth1DataDepositArr[i].depositCount,
      });
    }
  }
  // Add last item in eth1DataDepositArr which is not swept in the for loop above
  eth1DataDepositArrSeq.push(eth1DataDepositArr[eth1DataDepositArr.length - 1]);

  return eth1DataDepositArrSeq.filter(({blockNumber}) => blockNumber >= fromBlock && blockNumber <= toBlock);
}
