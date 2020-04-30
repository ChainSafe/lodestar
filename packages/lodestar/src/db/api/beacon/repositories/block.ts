import {Slot, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../schema";
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

  public async put(id: Uint8Array, value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.db.put(encodeKey(Bucket.blockSlotRefs, value.message.slot), id as Buffer),
      super.put(id, value),
    ]);
  }
  public async getBySlot(slot: Slot): Promise<SignedBeaconBlock | null> {
    const root = await this.db.get(encodeKey(Bucket.blockSlotRefs, slot));
    if (root === null) {
      return null;
    }
    return this.get(root);
  }
}
