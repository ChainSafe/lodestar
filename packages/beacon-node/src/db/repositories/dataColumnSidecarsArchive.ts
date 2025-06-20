import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {DataColumnSidecarsDbWrapper, dataColumnSidecarsDbWrapperSsz} from "./dataColumnSidecars.js";

/**
 * dataColumnSidecarsWrapper by slot
 *
 * Used to store finalized DataColumnSidecars
 */
export class DataColumnSidecarsArchiveRepository extends Repository<Slot, DataColumnSidecarsDbWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.fulu_dataColumnSidecarsArchive;
    super(config, db, bucket, dataColumnSidecarsDbWrapperSsz, getBucketNameByValue(bucket));
  }

  // Handle key as slot

  getId(value: DataColumnSidecarsDbWrapper): Slot {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
