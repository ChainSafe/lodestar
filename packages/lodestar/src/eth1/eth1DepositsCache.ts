import {Deposit, DepositEvent, Eth1Data} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {appendEth1DataDeposit} from "./utils/eth1DataDeposit";
import {IEth1Block} from "./types";
import {assertConsecutiveDeposits} from "./utils/eth1DepositEvent";
import {getDepositsWithProofs} from "./utils/deposits";

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
   * Add log to cache
   * This function enforces that `logs` are imported one-by-one with no gaps between
   * `log.index`, starting at `log.index == 0`.
   */
  async insertLogs(depositEvents: DepositEvent[]): Promise<void> {
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

    const depositRoots = depositEvents.map((depositEvent) => ({
      index: depositEvent.index,
      root: this.config.types.DepositData.hashTreeRoot(depositEvent.depositData),
    }));

    // Store everything in batch at once
    await Promise.all([
      this.db.depositEvent.batchPutValues(depositEvents),
      this.db.depositDataRoot.batchPutValues(depositRoots),
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
  ): Promise<(Eth1Data & IEth1Block)[]> {
    const highestBlock = blocks[blocks.length - 1]?.blockNumber;
    return await appendEth1DataDeposit(
      blocks,
      this.db.depositEvent.valuesStream({lte: highestBlock, reverse: true}),
      await this.db.depositDataRoot.getDepositRootTree(),
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
