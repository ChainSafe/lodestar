import {Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey, Key} from "../../../schema";

export class ChainRepository {

  private config: IBeaconConfig;

  private db: IDatabaseController;

  public constructor(config: IBeaconConfig, db: IDatabaseController) {
    this.db = db;
    this.config = config;
  }

  public getKey(id: Key): Buffer | string {
    return encodeKey(Bucket.chainInfo, id);
  }

  public getLatestStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.getKey(Key.latestState));
  }

  public async setLatestStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.getKey(Key.latestState),
      this.config.types.Root.serialize(root)
    );
  }

  public getJustifiedStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.getKey(Key.justifiedState));
  }

  public async setJustifiedStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.getKey(Key.justifiedState),
      this.config.types.Root.serialize(root)
    );
  }

  public getFinalizedStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.getKey(Key.finalizedState));
  }

  public async setFinalizedStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.getKey(Key.finalizedState),
      this.config.types.Root.serialize(root)
    );
  }

  public getFinalizedBlockRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.getKey(Key.finalizedBlock));
  }

  public async setFinalizedBlockRoot(root: Uint8Array): Promise<void> {
    return await this.db.put(this.getKey(Key.finalizedBlock), root);
  }

  public getJustifiedBlockRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.getKey(Key.justifiedBlock));
  }

  public async setJustifiedBlockRoot(root: Uint8Array): Promise<void> {
    return await this.db.put(this.getKey(Key.justifiedBlock), root);
  }

  public async getBlockRoot(slot: Slot): Promise<Uint8Array | null> {
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
      return this.config.types.Slot.deserialize(heightBuf);
    } catch (e) {
      return null;
    }
  }

  public async setChainHeadSlot(slot: number): Promise<void> {
    await this.db.put(this.getKey(Key.chainHeight), this.config.types.Slot.serialize(slot));
  }

  public async getChainHeadRoot(): Promise<Uint8Array | null> {
    const slot  = await this.getChainHeadSlot();
    if (slot === null) {
      return null;
    }
    return await this.getBlockRoot(slot);
  }
}
