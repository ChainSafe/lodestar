import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {Lightclient} from "@chainsafe/lodestar-types";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class LightClientBlockRepository extends Repository<Uint8Array, Lightclient.SignedBeaconBlock> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.block, config.types.lightclient.SignedBeaconBlock);
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  public getId(value: Lightclient.SignedBeaconBlock): Uint8Array {
    return this.config.types.lightclient.BeaconBlock.hashTreeRoot(value.message);
  }
}
