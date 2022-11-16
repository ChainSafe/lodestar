import {IChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {allForks, eip4844, ssz} from "@lodestar/types";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";

/**
 * BlobsSidecar by block root (= hash_tree_root(SignedBeaconBlockAndBlobsSidecar.beacon_block.message))
 *
 * Used to store unfinalized BlobsSidecar
 */
export class BlobsSidecarRepository extends Repository<Uint8Array, eip4844.BlobsSidecar> {
  constructor(config: IChainForkConfig, db: Db) {
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, Bucket.allForks_block, type);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: allForks.SignedBeaconBlock): Uint8Array {
    return this.config.getForkTypes(value.message.slot).BeaconBlock.hashTreeRoot(value.message);
  }

  encodeValue(value: allForks.SignedBeaconBlock): Buffer {
    return this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value) as Buffer;
  }

  decodeValue(data: Buffer): allForks.SignedBeaconBlock {
    return getSignedBlockTypeFromBytes(this.config, data).deserialize(data);
  }
}
