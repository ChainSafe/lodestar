import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {dataColumnSidecarsWrapperSsz, DataColumnSidecarsWrapper} from "./dataColumnSidecars.js";

/**
 * dataColumnSidecarsWrapper by slot
 *
 * Used to store finalized DataColumnSidecars
 */
export class DataColumnSidecarsArchiveRepository extends Repository<Slot, DataColumnSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_dataColumnSidecarsArchive;
    super(config, db, bucket, dataColumnSidecarsWrapperSsz, getBucketNameByValue(bucket));
  }

  // Handle key as slot

  getId(value: DataColumnSidecarsWrapper): Slot {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
