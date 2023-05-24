import {ChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {ValueOf, ContainerType} from "@chainsafe/ssz";

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
// ssz.deneb.BlobSidecars.elementType.fixedSize;
export const BLOBSIDECAR_FIXED_SIZE = 131256;

/**
 * blobSidecarsWrapper by block root (= hash_tree_root(SignedBeaconBlockAndBlobsSidecar.beacon_block.message))
 *
 * Used to store unfinalized BlobsSidecar
 */
export class BlobSidecarsRepository extends Repository<Uint8Array, BlobSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.allForks_blobSidecars, blobSidecarsWrapperSsz);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: BlobSidecarsWrapper): Uint8Array {
    const {blockRoot} = value;
    return blockRoot;
  }
}
