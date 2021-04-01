/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {CompositeType, ContainerType, TreeBacked} from "@chainsafe/ssz";
import {Epoch, Root, Slot, allForks} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";
import {getRootIndexKey, storeRootIndex} from "./db-index";

export class GenericStateArchiveRepository extends Repository<Slot, TreeBacked<allForks.BeaconState>> {
  constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    bucket: Bucket,
    type: ContainerType<allForks.BeaconState>
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(config, db, bucket, type as any);
  }

  async put(key: Slot, value: TreeBacked<allForks.BeaconState>): Promise<void> {
    await Promise.all([super.put(key, value), storeRootIndex(this.db, key, value.hashTreeRoot())]);
  }

  getId(state: TreeBacked<allForks.BeaconState>): Epoch {
    return state.slot;
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  decodeValue(data: Buffer): TreeBacked<allForks.BeaconState> {
    return ((this.type as unknown) as CompositeType<allForks.BeaconState>).createTreeBackedFromBytes(data);
  }

  async getByRoot(stateRoot: Root): Promise<TreeBacked<allForks.BeaconState> | null> {
    const slot = await this.getSlotByRoot(stateRoot);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  private async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }
}
