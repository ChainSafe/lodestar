import {Deposit} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {getEth1DataDepositFromDeposits, appendEth1DataDeposit} from "./utils/eth1DataDeposit";
import {getTreeAtIndex} from "../util/tree";
import {IEth1DataDeposit, IDepositLog, IEth1BlockHeader} from "./types";
import {assertConsecutiveDeposits} from "./utils/eth1DepositLog";

export class Eth1DepositsCache {
  db: IBeaconDb;
  config: IBeaconConfig;

  constructor(config: IBeaconConfig, db: IBeaconDb) {
    this.config = config;
    this.db = db;
  }

  /**
   * Returns a list of `Deposit` objects, within the given deposit index `range`.
   *
   * The `depositCount` is used to generate the proofs for the `Deposits`. For example, if we
   * have 100 proofs, but the eth2 chain only acknowledges 50 of them, we must produce our
   * proofs with respect to a tree size of 50.
   */
  async getDeposits({
    fromIndex,
    toIndex,
    depositCount,
  }: {
    fromIndex: number;
    toIndex: number;
    depositCount: number;
  }): Promise<Deposit[]> {
    if (depositCount < toIndex) {
      throw Error("Deposit count requests more deposits than should exist");
    }

    // Fetched a tree at this particular depositCount to compute correct proofs
    const depositRootTree = getTreeAtIndex(await this.db.depositDataRoot.getDepositRootTree(), depositCount);
    const tree = depositRootTree.tree();

    // ### TODO: Range is inclusive or exclusive?
    // Must assert that `toIndex <= logs.length`
    const depositLogs = await this.db.depositLog.getRange(fromIndex, toIndex);

    return depositLogs.map((log) => ({
      proof: tree.getSingleProof(depositRootTree.gindexOfProperty(log.index)),
      data: log.depositData,
    }));
  }

  /**
   * Add log to cache
   * This function enforces that `logs` are imported one-by-one with no gaps between
   * `log.index`, starting at `log.index == 0`.
   */
  async insertLogs(depositLogs: IDepositLog[]): Promise<void> {
    const lastLog = await this.db.depositLog.lastValue();
    const firstEvent = depositLogs[0];

    if (lastLog) {
      if (firstEvent.index <= lastLog.index) {
        throw Error("DuplicateDistinctLog");
      }
      if (firstEvent.index > lastLog.index + 1) {
        throw Error("Non consecutive logs");
      }
    }
    assertConsecutiveDeposits(depositLogs);

    // Pre-compute partial eth1 data from deposits
    // Add data for both getEth1DataDepositFromDeposits and db.depositDataRoot.batchPut
    const depositRootTree = await this.db.depositDataRoot.getDepositRootTree();
    const depositRoots = depositLogs.map((depositEvent) => ({
      blockNumber: depositEvent.blockNumber,
      index: depositEvent.index,
      root: this.config.types.DepositData.hashTreeRoot(depositEvent.depositData),
    }));
    const eth1DatasDeposit = getEth1DataDepositFromDeposits(depositRoots, depositRootTree);

    // Store everything in batch at once
    await Promise.all([
      this.db.depositLog.batchPut(
        depositLogs.map((depositLog) => ({
          key: depositLog.index,
          value: depositLog,
        }))
      ),
      this.db.depositDataRoot.batchPut(
        depositRoots.map((deposit) => ({
          key: deposit.index,
          value: deposit.root,
        }))
      ),
      this.db.eth1DataDeposit.batchPut(
        eth1DatasDeposit.map((eth1DataDeposit) => ({
          key: eth1DataDeposit.depositCount,
          value: eth1DataDeposit,
        }))
      ),
    ]);
  }

  /**
   * Appends partial eth1 data (depositRoot, depositCount) in a block range (inclusive)
   * Returned array is sequential and ascending in blockNumber
   * @param fromBlock
   * @param toBlock
   */
  async appendEth1DataDeposit(
    blocks: IEth1BlockHeader[],
    lastProcessedDepositBlockNumber?: number
  ): Promise<(IEth1BlockHeader & IEth1DataDeposit)[]> {
    const highestBlock = blocks[blocks.length - 1]?.blockNumber;
    return await appendEth1DataDeposit(
      blocks,
      this.db.eth1DataDeposit.valuesStream({lte: highestBlock, reverse: true}),
      lastProcessedDepositBlockNumber
    );
  }

  /**
   * Returns the highest blockNumber stored in DB if any
   */
  async geHighestDepositLogBlockNumber(): Promise<number | null> {
    const latestDepositLog = await this.db.depositLog.lastValue();
    return latestDepositLog && latestDepositLog.blockNumber;
  }
}
