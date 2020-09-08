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
 * @param eth1Datas
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
