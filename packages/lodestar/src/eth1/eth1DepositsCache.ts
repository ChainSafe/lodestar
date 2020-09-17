import {Deposit, DepositEvent, Eth1Data, Eth1Block} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {getEth1DataForBlocks} from "./utils/eth1Data";
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
  async get({
    indexRange,
    depositCount,
  }: {
    indexRange: {gt: number; lt: number};
    depositCount: number;
  }): Promise<Deposit[]> {
    const depositEvents = await this.db.depositEvent.values(indexRange);

    // Make sure all expected indexed are present (DB may not contain expected indexes)
    const expectedLength = indexRange.lt - indexRange.gt - 1;
    if (depositEvents.length < expectedLength) {
      throw Error("Not enough deposits in DB");
    }

    const depositRootTree = await this.db.depositDataRoot.getDepositRootTree();
    return getDepositsWithProofs(depositEvents, depositRootTree, depositCount);
  }

  /**
   * Add log to cache
   * This function enforces that `logs` are imported one-by-one with consecutive indexes
   */
  async add(depositEvents: DepositEvent[]): Promise<void> {
    assertConsecutiveDeposits(depositEvents);

    const lastLog = await this.db.depositEvent.lastValue();
    const firstEvent = depositEvents[0];
    if (lastLog && firstEvent) {
      if (firstEvent.index <= lastLog.index) {
        throw Error("DuplicateDistinctLog");
      }
      if (firstEvent.index > lastLog.index + 1) {
        throw Error("Non consecutive logs");
      }
    }

    const depositRoots = depositEvents.map((depositEvent) => ({
      index: depositEvent.index,
      root: this.config.types.DepositData.hashTreeRoot(depositEvent.depositData),
    }));

    // Store events after verifying that data is consecutive
    // depositDataRoot will throw if adding non consecutive roots
    await this.db.depositDataRoot.batchPutValues(depositRoots);
    await this.db.depositEvent.batchPutValues(depositEvents);
  }

  /**
   * Appends partial eth1 data (depositRoot, depositCount) in a block range (inclusive)
   * Returned array is sequential and ascending in blockNumber
   * @param fromBlock
   * @param toBlock
   */
  async getEth1DataForBlocks(
    blocks: Eth1Block[],
    lastProcessedDepositBlockNumber: number | null
  ): Promise<(Eth1Data & Eth1Block)[]> {
    const highestBlock = blocks[blocks.length - 1]?.blockNumber;
    return await getEth1DataForBlocks(
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
