import {ChainForkConfig} from "@lodestar/config";
import {Slot, ssz} from "@lodestar/types";
import {DatabaseController, Repository} from "@lodestar/db";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Slot to slot ranges that ensure that block range is fully backfilled
 *
 * If node starts backfilling at slots 1000, and backfills to 800, there will be an entry
 * 1000 -> 800
 *
 * When the node is backfilling if it starts at 1200 and backfills to 1000, it will find this sequence and,
 * jump directly to 800 and delete the key 1000.
 */
export class BackfilledRanges extends Repository<Slot, Slot> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.backfilled_ranges;
    super(config, db, bucket, ssz.Slot, getBucketNameByValue(bucket));
  }

  decodeKey(data: Buffer): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  getId(_value: Slot): number {
    throw new Error("Cannot get the db key from slot");
  }
}
