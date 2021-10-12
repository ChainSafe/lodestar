import {phase0, ssz} from "@chainsafe/lodestar-types";
import {IFilterOptions} from "@chainsafe/lodestar-db";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {getEth1DataForBlocks} from "./utils/eth1Data";
import {assertConsecutiveDeposits} from "./utils/eth1DepositEvent";
import {getDepositsWithProofs} from "./utils/deposits";
import {Eth1Error, Eth1ErrorCode} from "./errors";

export class Eth1DepositsCache {
  db: IBeaconDb;
  config: IChainForkConfig;

  constructor(config: IChainForkConfig, db: IBeaconDb) {
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
  async get(indexRange: IFilterOptions<number>, eth1Data: phase0.Eth1Data): Promise<phase0.Deposit[]> {
    const depositEvents = await this.db.depositEvent.values(indexRange);
    const depositRootTree = await this.db.depositDataRoot.getDepositRootTree();
    return getDepositsWithProofs(depositEvents, depositRootTree, eth1Data);
  }

  /**
   * Add log to cache
   * This function enforces that `logs` are imported one-by-one with consecutive indexes
   */
  async add(depositEvents: phase0.DepositEvent[]): Promise<void> {
    assertConsecutiveDeposits(depositEvents);

    const lastLog = await this.db.depositEvent.lastValue();
    const firstEvent = depositEvents[0];
    if (lastLog !== null && firstEvent !== undefined) {
      const newIndex = firstEvent.index;
      const prevIndex = lastLog.index;
      if (newIndex <= prevIndex) {
        throw new Eth1Error({code: Eth1ErrorCode.DUPLICATE_DISTINCT_LOG, newIndex, prevIndex});
      }
      if (newIndex > prevIndex + 1) {
        throw new Eth1Error({code: Eth1ErrorCode.NON_CONSECUTIVE_LOGS, newIndex, prevIndex});
      }
    }

    const depositRoots = depositEvents.map((depositEvent) => ({
      index: depositEvent.index,
      root: ssz.phase0.DepositData.hashTreeRoot(depositEvent.depositData),
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
    blocks: phase0.Eth1Block[],
    lastProcessedDepositBlockNumber: number | null
  ): Promise<(phase0.Eth1Data & phase0.Eth1Block)[]> {
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
  async getHighestDepositEventBlockNumber(): Promise<number | null> {
    const latestEvent = await this.db.depositEvent.lastValue();
    return latestEvent && latestEvent.blockNumber;
  }

  /**
   * Returns the lowest blockNumber stored in DB if any
   */
  async getLowestDepositEventBlockNumber(): Promise<number | null> {
    const firstEvent = await this.db.depositEvent.firstValue();
    return firstEvent && firstEvent.blockNumber;
  }
}
