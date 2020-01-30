import {Slot, Root, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {ChainRepository} from "./chain";
import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../../schema";

export class BlockRepository extends BulkRepository<SignedBeaconBlock> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    chain: ChainRepository) {
    super(config, db, Bucket.block, config.types.SignedBeaconBlock);
    this.chain = chain;
  }

  public getId(value: SignedBeaconBlock): Root {
    return this.config.types.BeaconBlock.hashTreeRoot(value.message);
  }

  public async set(id: Root, value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      this.db.put(encodeKey(Bucket.blockSlotRefs, value.message.slot), id),
      this.db.put(encodeKey(Bucket.blockRootRefs, id), this.config.types.Slot.serialize(value.message.slot)),
      super.set(id, value)
    ]);
  }

  public async getFinalizedBlock(): Promise<SignedBeaconBlock | null> {
    const root = await this.chain.getFinalizedBlockRoot();
    if(!root) return null;
    return await this.get(root);
  }

  public async getJustifiedBlock(): Promise<SignedBeaconBlock | null> {
    const root = await this.chain.getJustifiedBlockRoot();
    if(!root) return null;
    return await this.get(root);
  }

  public async getBlockBySlot(slot: Slot): Promise<SignedBeaconBlock | null> {
    const root = await this.db.get(encodeKey(Bucket.blockSlotRefs, slot));
    if (root === null) {
      return null;
    }
    return await this.get(root);
  }

  public async getChainHead(): Promise<SignedBeaconBlock|null> {
    const root = await this.chain.getChainHeadRoot();
    if (root === null) {
      return null;
    }
    return await this.get(root);
  }

  public async storeBadBlock(root: Root): Promise<void> {
    return await this.db.put(
      encodeKey(Bucket.invalidBlock, root),
      this.config.types.bool.serialize(true)
    );
  }

  public async isBadBlock(root: Root): Promise<boolean> {
    return !! await this.db.get(encodeKey(Bucket.invalidBlock, root));
  }

}
