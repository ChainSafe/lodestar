import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../db";
import {IEth1Block} from "./types";

/**
 * Stores eth1 block headers.
 * To construct a full eth1Data object, use the DepositCache
 */
export class Eth1BlockCache {
  db: IBeaconDb;
  config: IBeaconConfig;

  constructor(config: IBeaconConfig, db: IBeaconDb) {
    this.config = config;
    this.db = db;
  }

  async insertBlockHeaders(blockHeaders: IEth1Block[]): Promise<void> {
    await this.db.eth1Block.batchPutValues(blockHeaders);
  }

  /**
   * Returns a stream of blocks from DB
   * Blocks a guaranteed to be returned with;
   * - Monotonically decreasing block numbers.
   * - Non-uniformly decreasing block timestamps.
   *
   * Eth1 blocks should be pruned regularly at the end of an Eth1 voting period,
   * so there should never be a significant amount of blocks to read
   */
  getReverseStream(): AsyncIterable<IEth1Block> {
    return this.db.eth1Block.valuesStream({reverse: true});
  }

  /**
   * Returns the highest blockNumber stored in DB if any
   */
  async getHighestBlockNumber(): Promise<number | null> {
    const lastestBlockHeader = await this.db.eth1Block.lastValue();
    return lastestBlockHeader && lastestBlockHeader.number;
  }
}
