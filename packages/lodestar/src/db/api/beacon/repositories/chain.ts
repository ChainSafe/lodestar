import {Hash, Slot} from "@chainsafe/eth2.0-types";
import {deserialize, serialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey, Key} from "../../../schema";

export class ChainRepository {

  private config: IBeaconConfig;

  private db: IDatabaseController;

  public constructor(config: IBeaconConfig, db: IDatabaseController) {
    this.db = db;
    this.config = config;
  }

  public getLatestStateRoot(): Promise<Hash|null> {
    return this.db.get(this.getKey(Key.latestState));
  }

  public async setLatestStateRoot(root: Hash): Promise<void> {
    await this.db.put(
      this.getKey(Key.latestState),
      serialize(this.config.types.bytes32, root)
    );
  }

  public getJustifiedStateRoot(): Promise<Hash|null> {
    return this.db.get(this.getKey(Key.justifiedState));
  }

  public async setJustifiedStateRoot(root: Hash): Promise<void> {
    await this.db.put(
      this.getKey(Key.justifiedState),
      serialize(this.config.types.bytes32, root)
    );
  }

  public getFinalizedStateRoot(): Promise<Hash|null> {
    return this.db.get(this.getKey(Key.finalizedState));
  }

  public async setFinalizedStateRoot(root: Hash): Promise<void> {
    await this.db.put(
      this.getKey(Key.finalizedState),
      serialize(this.config.types.bytes32, root)
    );
  }

  public getFinalizedBlockRoot(): Promise<Hash|null> {
    return this.db.get(this.getKey(Key.finalizedBlock));
  }

  public async setFinalizedBlockRoot(root: Hash): Promise<void> {
    return await this.db.put(this.getKey(Key.finalizedBlock), root);
  }

  public getJustifiedBlockRoot(): Promise<Hash|null> {
    return this.db.get(this.getKey(Key.justifiedBlock));
  }

  public async setJustifiedBlockRoot(root: Hash): Promise<void> {
    return await this.db.put(this.getKey(Key.justifiedBlock), root);
  }

  public async getBlockRoot(slot: Slot): Promise<Hash | null> {
    try {
      return await this.db.get(encodeKey(Bucket.blockSlotRefs, slot));
    } catch (e) {
      return null;
    }
  }

  public async getChainHeadSlot(): Promise<Slot | null> {
    try {
      const heightBuf = await this.db.get(this.getKey(Key.chainHeight));
      if(!heightBuf) {
        throw new Error("Missing chain height");
      }
      return deserialize(this.config.types.Slot, heightBuf);
    } catch (e) {
      return null;
    }
  }

  public async setChainHeadSlot(slot: number): Promise<void> {
    await this.db.put(this.getKey(Key.chainHeight), serialize(this.config.types.Slot, slot));
  }

  public async getChainHeadRoot(): Promise<Hash | null> {
    const slot  = await this.getChainHeadSlot();
    if (slot === null) {
      return null;
    }
    return await this.getBlockRoot(slot);
  }

  private getKey(id: Key): Buffer | string {
    return encodeKey(Bucket.chainInfo, id);
  }
}
