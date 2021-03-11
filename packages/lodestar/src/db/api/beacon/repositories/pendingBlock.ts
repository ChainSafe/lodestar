import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * Blocks by root
 *
 * Used to store pending blocks
 */
export class PendingBlockRepository extends Repository<Uint8Array, phase0.SignedBeaconBlock> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_pendingBlock, config.types.phase0.SignedBeaconBlock);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: phase0.SignedBeaconBlock): Uint8Array {
    return this.config.types.phase0.BeaconBlock.hashTreeRoot(value.message);
  }
}
