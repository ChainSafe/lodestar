import {Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey, Key} from "../../schema";

export class ChainRepository {

  private config: IBeaconConfig;
  private db: IDatabaseController<Buffer, Buffer>;

  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    this.db = db;
    this.config = config;
  }

  public encodeKey(id: Key): Buffer {
    return encodeKey(Bucket.chainInfo, id);
  }

  public getLatestStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.encodeKey(Key.latestState));
  }

  public async setLatestStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.encodeKey(Key.latestState),
      this.config.types.Root.serialize(root) as Buffer
    );
  }

  public getJustifiedStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.encodeKey(Key.justifiedState));
  }

  public async setJustifiedStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.encodeKey(Key.justifiedState),
      this.config.types.Root.serialize(root) as Buffer
    );
  }

  public getFinalizedStateRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.encodeKey(Key.finalizedState));
  }

  public async setFinalizedStateRoot(root: Uint8Array): Promise<void> {
    await this.db.put(
      this.encodeKey(Key.finalizedState),
      this.config.types.Root.serialize(root) as Buffer
    );
  }

  public getFinalizedBlockRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.encodeKey(Key.finalizedBlock));
  }

  public async setFinalizedBlockRoot(root: Uint8Array): Promise<void> {
    return await this.db.put(this.encodeKey(Key.finalizedBlock), root as Buffer);
  }

  public getJustifiedBlockRoot(): Promise<Uint8Array|null> {
    return this.db.get(this.encodeKey(Key.justifiedBlock));
  }

  public async setJustifiedBlockRoot(root: Uint8Array): Promise<void> {
    return await this.db.put(this.encodeKey(Key.justifiedBlock), root as Buffer);
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
      const heightBuf = await this.db.get(this.encodeKey(Key.chainHeight));
      if(!heightBuf) {
        throw new Error("Missing chain height");
      }
      return this.config.types.Slot.deserialize(heightBuf);
    } catch (e) {
      return null;
    }
  }

  public async setChainHeadSlot(slot: number): Promise<void> {
    await this.db.put(this.encodeKey(Key.chainHeight), this.config.types.Slot.serialize(slot) as Buffer);
  }

  public async getChainHeadRoot(): Promise<Uint8Array | null> {
    const slot  = await this.getChainHeadSlot();
    if (slot === null) {
      return null;
    }
    return await this.getBlockRoot(slot);
  }
}
