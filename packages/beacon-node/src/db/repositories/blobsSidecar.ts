import {IChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {eip4844, ssz} from "@lodestar/types";

/**
 * BlobsSidecar by block root (= hash_tree_root(SignedBeaconBlockAndBlobsSidecar.beacon_block.message))
 *
 * Used to store unfinalized BlobsSidecar
 */
export class BlobsSidecarRepository extends Repository<Uint8Array, eip4844.BlobsSidecar> {
  constructor(config: IChainForkConfig, db: Db) {
    super(config, db, Bucket.allForks_blobsSidecar, ssz.eip4844.BlobsSidecar);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: eip4844.BlobsSidecar): Uint8Array {
    return value.beaconBlockRoot;
  }
}
