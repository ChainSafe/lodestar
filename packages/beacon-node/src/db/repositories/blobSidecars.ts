import {ValueOf, ContainerType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";

import {Bucket, getBucketNameByValue} from "../buckets.js";

export const blobSidecarsWrapperSsz = new ContainerType(
  {
    blockRoot: ssz.Root,
    slot: ssz.Slot,
    blobSidecars: ssz.deneb.BlobSidecars,
  },
  {typeName: "BlobSidecarsWrapper", jsonCase: "eth2"}
);

export type BlobSidecarsWrapper = ValueOf<typeof blobSidecarsWrapperSsz>;
export const BLOB_SIDECARS_IN_WRAPPER_INDEX = 44;

/**
 * blobSidecarsWrapper by block root (= hash_tree_root(SignedBeaconBlock.message))
 *
 * Used to store unfinalized BlobSidecars
 */
export class BlobSidecarsRepository extends Repository<Uint8Array, BlobSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blobSidecars;
    super(config, db, bucket, blobSidecarsWrapperSsz, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: BlobSidecarsWrapper): Uint8Array {
    const {blockRoot} = value;
    return blockRoot;
  }
}
