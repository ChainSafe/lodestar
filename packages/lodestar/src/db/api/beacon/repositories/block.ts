import {DatabaseRepository} from "../repository";
import {BeaconBlock, bytes32, Slot} from "../../../../types";
import {ChainRepository} from "./chain";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../../schema";
import {serialize} from "@chainsafe/ssz";

export class BlockRepository extends DatabaseRepository<BeaconBlock> {

  private chain: ChainRepository;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    chain: ChainRepository) {
    super(config, db, Bucket.state, config.types.BeaconState);
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

  public async storeBadBlock(root: bytes32): Promise<void> {
    return await this.db.put(
      encodeKey(Bucket.invalidBlock, root),
      serialize(true, this.config.types.bool)
    );
  }

  public async isBadBlock(root: bytes32): Promise<boolean> {
    return !!this.db.get(encodeKey(Bucket.invalidBlock, root));
  }

}
