import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, phase0.SignedBeaconBlock> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_block, config.types.phase0.SignedBeaconBlock);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: phase0.SignedBeaconBlock): Uint8Array {
    return this.config.types.phase0.BeaconBlock.hashTreeRoot(value.message);
  }
}
