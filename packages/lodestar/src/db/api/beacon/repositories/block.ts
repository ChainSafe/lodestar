import {BeaconBlock, bytes32, Hash, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {serialize} from "@chainsafe/ssz";

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
    super(config, db, Bucket.state, config.types.BeaconBlock);
    this.chain = chain;
  }

  public async getFinalizedBlock(): Promise<BeaconBlock | null> {
    return await this.get(await this.chain.getFinalizedBlockRoot());
  }

  public async getJustifiedBlock(): Promise<BeaconBlock | null> {
    return await this.get(await this.chain.getJustifiedBlockRoot());
  }

  public async getBlockBySlot(slot: Slot): Promise<BeaconBlock | null> {
    const root = await this.chain.getBlockRoot(slot);
    if (root === null) {
      return null;
    }
    return await this.get(root);
  }

  public async getChainHead(): Promise<BeaconBlock> {
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
