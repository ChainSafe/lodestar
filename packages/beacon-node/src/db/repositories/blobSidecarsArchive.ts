import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {BlobSidecarsWrapper, blobSidecarsWrapperSsz} from "./blobSidecars.js";

/**
 * blobSidecarsWrapper by slot
 *
 * Used to store finalized BlobSidecars
 */
export class BlobSidecarsArchiveRepository extends Repository<Slot, BlobSidecarsWrapper> {
  private prunedBeforeSlot: Slot | null = null;

  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.deneb_blobSidecarsArchive;
    super(config, db, bucket, blobSidecarsWrapperSsz, getBucketNameByValue(bucket));
  }

  // Handle key as slot

  getId(value: BlobSidecarsWrapper): Slot {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  /**
   * Deletes all entries before `slot`. Prunes only delete from the start of the bucket, so the first prune
   * compacts the range to drop tombstones of earlier runs and later prunes resume where the previous one ended.
   */
  async pruneBefore(slot: Slot): Promise<Slot[]> {
    if (this.prunedBeforeSlot === null) {
      await this.db.compactRange(this.minKey, this.encodeKey(slot));
    } else if (slot <= this.prunedBeforeSlot) {
      return [];
    }

    const slots = await this.keys({gte: this.prunedBeforeSlot ?? undefined, lt: slot});
    if (slots.length > 0) await this.batchDelete(slots);
    this.prunedBeforeSlot = slot;
    return slots;
  }
}
