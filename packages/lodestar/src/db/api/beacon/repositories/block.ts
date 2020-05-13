import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";
import {ChainRepository} from "./chain";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, SignedBeaconBlock> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    chain: ChainRepository) {
    super(config, db, Bucket.block, config.types.SignedBeaconBlock);
    this.chain = chain;
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  public getId(value: SignedBeaconBlock): Uint8Array {
    return this.config.types.BeaconBlock.hashTreeRoot(value.message);
  }
}
