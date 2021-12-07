import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Slot, ssz} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {bytesToInt} from "@chainsafe/lodestar-utils";

export class BackfilledRanges extends Repository<Slot, Slot> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    super(config, db, Bucket.backfilled_ranges, ssz.Slot, metrics);
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getId(value: Slot): number {
    throw new Error("Cannot get the db key from slot");
  }
}
