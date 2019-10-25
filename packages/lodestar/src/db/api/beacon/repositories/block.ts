import {BeaconBlock, Hash, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {AnyContainerType, serialize, signingRoot} from "@chainsafe/ssz";

import {Repository} from "../repository";
import {ChainRepository} from "./chain";
import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../../schema";

export class BlockRepository extends Repository<BeaconBlock> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    chain: ChainRepository) {
    super(config, db, Bucket.block, config.types.BeaconBlock);
    this.chain = chain;
  }

  public async set(id: Hash, value: BeaconBlock): Promise<void> {
    await Promise.all([
      this.db.put(encodeKey(Bucket.blockSlotRefs, value.slot), id),
      this.db.put(encodeKey(Bucket.blockRootRefs, id), serialize(value.slot, this.config.types.Slot)),
      super.set(id, value)
    ]);
  }

  public async setUnderRoot(block: BeaconBlock): Promise<void> {
    await this.set(signingRoot(block, this.type as AnyContainerType), block);
  }

  public async getFinalizedBlock(): Promise<BeaconBlock | null> {
    const root = await this.chain.getFinalizedBlockRoot();
    if(!root) return null;
    return await this.get(root);
  }

  public async getJustifiedBlock(): Promise<BeaconBlock | null> {
    const root = await this.chain.getJustifiedBlockRoot();
    if(!root) return null;
    return await this.get(root);
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock | null> {
    const root = await this.db.get(encodeKey(Bucket.blockSlotRefs, slot));
    if (root === null) {
      return null;
    }
    return await this.get(root);
  }

  public async getChainHead(): Promise<BeaconBlock|null> {
    const root = await this.chain.getChainHeadRoot();
    if (root === null) {
      return null;
    }
    return await this.get(root);
  }

  public async storeBadBlock(root: Hash): Promise<void> {
    return await this.db.put(
      encodeKey(Bucket.invalidBlock, root),
      serialize(true, this.config.types.bool)
    );
  }

  public async isBadBlock(root: Hash): Promise<boolean> {
    return !! await this.db.get(encodeKey(Bucket.invalidBlock, root));
  }

}
