import {Eth1Data, Eth1DataOrdered} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

export class Eth1DataRepository extends Repository<number, Eth1DataOrdered> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.eth1Data, config.types.Eth1DataOrdered);
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getId(value: Eth1Data): number {
    throw new Error("Unable to create timestamp from block hash");
  }

  public async batchPutValues(eth1Datas: (Eth1DataOrdered & {timestamp: number})[]): Promise<void> {
    await this.batchPut(
      eth1Datas.map((eth1Data) => ({
        key: eth1Data.timestamp,
        value: eth1Data,
      }))
    );
  }

  public async deleteOld(timestamp: number): Promise<void> {
    await this.batchDelete(await this.keys({lt: timestamp}));
  }
}
