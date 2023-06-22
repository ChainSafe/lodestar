import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {blobSidecarsWrapperSsz, BlobSidecarsWrapper} from "./blobSidecars.js";

/**
 * blobSidecarsWrapper by slot
 *
 * Used to store finalized BlobSidecars
 */
export class BlobSidecarsArchiveRepository extends Repository<Slot, BlobSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blobSidecarsArchive;
    super(config, db, bucket, blobSidecarsWrapperSsz, getBucketNameByValue(bucket));
  }

  // Handle key as slot

  getId(value: BlobSidecarsWrapper): Slot {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
