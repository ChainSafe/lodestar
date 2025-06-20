import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";

import {DataColumnSidecarsDbWrapper, dataColumnSidecarsDbWrapperSsz} from "../../util/dataColumns.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * dataColumnSidecarsWrapper by block root (= hash_tree_root(SignedBeaconBlock.message))
 *
 * Used to store unfinalized DataColumnSidecars
 */
export class DataColumnSidecarsRepository extends Repository<Uint8Array, DataColumnSidecarsDbWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.fulu_dataColumnSidecars;
    super(config, db, bucket, dataColumnSidecarsDbWrapperSsz, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: DataColumnSidecarsDbWrapper): Uint8Array {
    const {blockRoot} = value;
    return blockRoot;
  }
}
