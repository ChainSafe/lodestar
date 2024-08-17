import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {blindedOrFullBlockHashTreeRoot} from "@lodestar/state-transition";
import {
  FullOrBlindedSignedBeaconBlock,
  blindedOrFullBlockToBlinded,
  serializeFullOrBlindedSignedBeaconBlock,
  deserializeFullOrBlindedSignedBeaconBlock,
} from "../../util/fullOrBlindedBlock.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, FullOrBlindedSignedBeaconBlock> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_block;
    // Pick some type but won't be used, override below so correct container is used
    const type = ssz.phase0.SignedBeaconBlock;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: FullOrBlindedSignedBeaconBlock): Uint8Array {
    return blindedOrFullBlockHashTreeRoot(this.config, value.message);
  }

  encodeValue(value: FullOrBlindedSignedBeaconBlock): Uint8Array {
    return serializeFullOrBlindedSignedBeaconBlock(this.config, value);
  }

  decodeValue(data: Uint8Array): FullOrBlindedSignedBeaconBlock {
    return deserializeFullOrBlindedSignedBeaconBlock(this.config, data);
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  async putBinary(_: Uint8Array, __: Uint8Array): Promise<void> {
    throw new Error("cannot .putBinary into BlockRepository. must use .add so can be saved blinded");
  }

  async add(value: FullOrBlindedSignedBeaconBlock): Promise<void> {
    return super.add(blindedOrFullBlockToBlinded(value));
  }
}
