import {ChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {deneb, ssz} from "@lodestar/types";

/**
 * BlobsSidecar by block root (= hash_tree_root(SignedBeaconBlockAndBlobsSidecar.beacon_block.message))
 *
 * Used to store unfinalized BlobsSidecar
 */
export class BlobsSidecarRepository extends Repository<Uint8Array, deneb.BlobsSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.allForks_blobsSidecar, ssz.deneb.BlobsSidecar);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: deneb.BlobsSidecar): Uint8Array {
    return value.beaconBlockRoot;
  }
}
