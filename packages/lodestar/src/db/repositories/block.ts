import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {allForks} from "@chainsafe/lodestar-types";
import {getBlockTypeFromBlock, getBlockTypeFromBytes} from "./utils/multifork";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, allForks.SignedBeaconBlock> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    const type = config.types.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, Bucket.allForks_block, type);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: allForks.SignedBeaconBlock): Uint8Array {
    return getBlockTypeFromBlock(this.config, value).fields["message"].hashTreeRoot(value.message);
  }

  encodeValue(value: allForks.SignedBeaconBlock): Buffer {
    return getBlockTypeFromBlock(this.config, value).serialize(value) as Buffer;
  }

  decodeValue(data: Buffer): allForks.SignedBeaconBlock {
    return getBlockTypeFromBytes(this.config, data).deserialize(data);
  }
}
