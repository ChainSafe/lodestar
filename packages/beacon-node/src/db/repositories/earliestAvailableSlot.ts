import {Db, encodeKey} from "@lodestar/db";
import {Slot, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class EarliestAvailableSlotRepository {
  private readonly key = encodeKey(Bucket.earliestAvailableSlot, 0);
  private readonly opts = {bucketId: getBucketNameByValue(Bucket.earliestAvailableSlot)};

  constructor(private readonly db: Db) {}

  async get(): Promise<Slot | null> {
    const bytes = await this.db.get(this.key, this.opts);
    return bytes === null ? null : ssz.Slot.deserialize(bytes);
  }

  async set(slot: Slot): Promise<void> {
    await this.db.put(this.key, ssz.Slot.serialize(slot), this.opts);
  }
}
