import {ChainForkConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {IBeaconDb} from "../db/index.js";

export class Eth1DataCache {
  db: IBeaconDb;
  config: ChainForkConfig;

  constructor(config: ChainForkConfig, db: IBeaconDb) {
    this.config = config;
    this.db = db;
  }

  async get({timestampRange}: {timestampRange: {gte: number; lte: number}}): Promise<phase0.Eth1DataOrdered[]> {
    return this.db.eth1Data.values(timestampRange);
  }

  async add(eth1Datas: (phase0.Eth1DataOrdered & {timestamp: number})[]): Promise<void> {
    await this.db.eth1Data.batchPutValues(eth1Datas);
  }

  async getHighestCachedBlockNumber(): Promise<number | null> {
    const highestEth1Data = await this.db.eth1Data.lastValue();
    const snapshot = await this.db.depositTreeSnapshot.lastValue();

    // for the first time, when there is no eth1 data in the db, go with snapshot block height if we have it
    // otherwise start with the last eth1 block number
    return highestEth1Data?.blockNumber ?? snapshot?.executionBlockHeight ?? null;
  }
}
