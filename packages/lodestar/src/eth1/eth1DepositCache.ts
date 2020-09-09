import {Deposit} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {
  getEth1DataDepositFromDeposits,
  appendEth1DataDeposit,
  assertConsecutiveDeposits,
  getDepositsWithProofs,
} from "./utils";
import {IDepositEvent, IEth1Block, IEth1DataWithBlock} from "./types";

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

    // ### TODO: Range is inclusive or exclusive?
    // Must assert that `toIndex <= logs.length`
    const depositEvents = await this.db.depositEvent.getRange(fromIndex, toIndex);
    const depositRootTree = await this.db.depositDataRoot.getDepositRootTree();
    return getDepositsWithProofs(depositEvents, depositRootTree, depositCount);
  }

  /**
   * Add deposit events to cache
   * This function enforces that `logs` are imported one-by-one with no gaps between
   * `log.index`, starting at `log.index == 0`.
   */
  async insertLogs(depositEvents: IDepositEvent[]): Promise<void> {
    const lastLog = await this.db.depositEvent.lastValue();
    const firstEvent = depositEvents[0];

    if (lastLog) {
      if (firstEvent.index <= lastLog.index) {
        throw Error("DuplicateDistinctLog");
      }
      if (firstEvent.index > lastLog.index + 1) {
        throw Error("Non consecutive logs");
      }
    }
    assertConsecutiveDeposits(depositEvents);

    // Pre-compute partial eth1 data from deposits
    // Add data for both getEth1DataDepositFromDeposits and db.depositDataRoot.batchPut
    const depositRootTree = await this.db.depositDataRoot.getDepositRootTree();
    const depositRoots = depositEvents.map((depositEvent) => ({
      blockNumber: depositEvent.blockNumber,
      index: depositEvent.index,
      root: this.config.types.DepositData.hashTreeRoot(depositEvent.depositData),
    }));
    const eth1DatasDeposit = getEth1DataDepositFromDeposits(depositRoots, depositRootTree);

    // Store everything in batch at once
    await Promise.all([
      this.db.depositEvent.batchPutValues(depositEvents),
      this.db.depositDataRoot.batchPutValues(depositRoots),
      this.db.eth1DataDeposit.batchPutValues(eth1DatasDeposit),
    ]);
  }

  /**
   * Appends partial eth1 data (depositRoot, depositCount) in a block range (inclusive)
   * Returned array is sequential and ascending in blockNumber
   * @param fromBlock
   * @param toBlock
   */
  async appendEth1DataDeposit(
    blocks: IEth1Block[],
    lastProcessedDepositBlockNumber?: number
  ): Promise<IEth1DataWithBlock[]> {
    const highestBlock = blocks[blocks.length - 1]?.number;
    return await appendEth1DataDeposit(
      blocks,
      this.db.eth1DataDeposit.valuesStream({lte: highestBlock, reverse: true}),
      lastProcessedDepositBlockNumber
    );
  }

  /**
   * Returns the highest blockNumber stored in DB if any
   */
  async geHighestDepositEventBlockNumber(): Promise<number | null> {
    const latestDepositEvent = await this.db.depositEvent.lastValue();
    return latestDepositEvent && latestDepositEvent.blockNumber;
  }
}
