import {IDatabaseController} from "../../../controller";
import {BeaconBlock, bytes32, Slot} from "../../../../types";
import {Key, Bucket, encodeKey} from "../../../schema";
import {deserialize, serialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "../../../../config";

export class ChainRepository {

  private config: IBeaconConfig;

  private db: IDatabaseController;

  public constructor(config: IBeaconConfig, db: IDatabaseController) {
    this.db = db;
    this.config = config;
  }

  public getLatestStateRoot(): Promise<bytes32> {
    return this.db.get(this.getKey(Key.latestState));
  }

  public async setLatestStateRoot(root: bytes32): Promise<void> {
    await this.db.put(
      this.getKey(Key.latestState),
      serialize(root, this.config.types.bytes32)
    );
  }

  public getJustifiedStateRoot(): Promise<bytes32> {
    return this.db.get(this.getKey(Key.justifiedState));
  }

  public async setJustifiedStateRoot(root: bytes32): Promise<void> {
    await this.db.put(
      this.getKey(Key.justifiedState),
      serialize(root, this.config.types.bytes32)
    );
  }

  public getFinalizedStateRoot(): Promise<bytes32> {
    return this.db.get(this.getKey(Key.finalizedState));
  }

  public async setFinalizedStateRoot(root: bytes32): Promise<void> {
    await this.db.put(
      this.getKey(Key.finalizedState),
      serialize(root, this.config.types.bytes32)
    );
  }

  public getFinalizedBlockRoot(): Promise<bytes32> {
    return this.db.get(this.getKey(Key.finalizedBlock));
  }

  public async setFinalizedBlockRoot(root: bytes32): Promise<void> {
    return await this.db.put(this.getKey(Key.finalizedBlock), root);
  }

  public getJustifiedBlockRoot(): Promise<bytes32> {
    return this.db.get(this.getKey(Key.justifiedBlock));
  }

  public async setJustifiedBlockRoot(root: bytes32): Promise<void> {
    return await this.db.put(this.getKey(Key.justifiedBlock), root);
  }

  public async getBlockRoot(slot: Slot): Promise<bytes32 | null> {
    try {
      return await this.db.get(encodeKey(Bucket.mainChain, slot));
    } catch (e) {
      return null;
    }
  }

  public async getChainHeadSlot(): Promise<Slot | null> {
    try {
      const heightBuf = await this.db.get(this.getKey(Key.chainHeight));
      return deserialize(heightBuf, this.config.types.Slot) as Slot;
    } catch (e) {
      return null;
    }
  }

  public async getChainHeadRoot(): Promise<bytes32 | null> {
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
