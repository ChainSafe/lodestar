import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Bucket, Db, IDbMetrics, Repository} from "@chainsafe/lodestar-db";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {getSignedBlockTypeFromBytes} from "../../util/multifork";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, allForks.SignedBeaconBlock> {
  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, Bucket.allForks_block, type, metrics);
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
