import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {deneb, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * BlobsSidecar by block root (= hash_tree_root(SignedBeaconBlockAndBlobsSidecar.beacon_block.message))
 *
 * Used to store unfinalized BlobsSidecar
 */
export class BlobsSidecarRepository extends Repository<Uint8Array, deneb.BlobsSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blobsSidecar;
    super(config, db, bucket, ssz.deneb.BlobsSidecar, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: deneb.BlobsSidecar): Uint8Array {
    return value.beaconBlockRoot;
  }
}
