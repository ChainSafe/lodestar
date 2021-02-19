import {TreeBacked, CompositeType} from "@chainsafe/ssz";
import {phase0, Epoch, Root, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository, encodeKey} from "@chainsafe/lodestar-db";

export class StateArchiveRepository extends Repository<Slot, TreeBacked<phase0.BeaconState>> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(
      config,
      db,
      Bucket.state,
      (config.types.phase0.BeaconState as unknown) as CompositeType<TreeBacked<phase0.BeaconState>>
    );
  }

  public async put(key: Slot, value: TreeBacked<phase0.BeaconState>): Promise<void> {
    await Promise.all([super.put(key, value), this.storeRootIndex(key, value.hashTreeRoot())]);
  }

  public getId(state: TreeBacked<phase0.BeaconState>): Epoch {
    return state.slot;
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  public decodeValue(data: Buffer): TreeBacked<phase0.BeaconState> {
    return ((this.type as unknown) as CompositeType<phase0.BeaconState>).tree.deserialize(data);
  }

  public async getByRoot(stateRoot: Root): Promise<TreeBacked<phase0.BeaconState> | null> {
    const slot = await this.getSlotByRoot(stateRoot);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  private async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(this.getRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  private storeRootIndex(slot: Slot, stateRoot: Root): Promise<void> {
    return this.db.put(this.getRootIndexKey(stateRoot), intToBytes(slot, 64, "be"));
  }

  private getRootIndexKey(root: Root): Buffer {
    return encodeKey(Bucket.stateArchiveRootIndex, root.valueOf() as Uint8Array);
  }
}
