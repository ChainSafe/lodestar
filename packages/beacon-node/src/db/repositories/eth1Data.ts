import {phase0, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {bytesToInt} from "@lodestar/utils";
import {Db, Bucket, Repository} from "@lodestar/db";

export class Eth1DataRepository extends Repository<number, phase0.Eth1DataOrdered> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.phase0_eth1Data, ssz.phase0.Eth1DataOrdered);
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: phase0.Eth1Data): number {
    throw new Error("Unable to create timestamp from block hash");
  }

  async batchPutValues(eth1Datas: (phase0.Eth1DataOrdered & {timestamp: number})[]): Promise<void> {
    await this.batchPut(
      eth1Datas.map((eth1Data) => ({
        key: eth1Data.timestamp,
        value: eth1Data,
      }))
    );
  }

  async deleteOld(timestamp: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: timestamp}));
  }
}
