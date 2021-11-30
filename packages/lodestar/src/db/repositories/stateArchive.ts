import {ContainerType, TreeBacked} from "@chainsafe/ssz";
import {Epoch, Root, Slot, allForks, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {Db, Bucket, Repository, IDbMetrics} from "@chainsafe/lodestar-db";
import {getStateTypeFromBytes} from "../../util/multifork";
import {getRootIndexKey, storeRootIndex} from "./stateArchiveIndex";

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

export class StateArchiveRepository extends Repository<Slot, TreeBacked<allForks.BeaconState>> {
  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    // Pick some type but won't be used
    const type = (ssz.phase0.BeaconState as unknown) as ContainerType<TreeBacked<allForks.BeaconState>>;
    super(config, db, Bucket.allForks_stateArchive, type, metrics);
  }

  // Overrides for multi-fork

  encodeValue(value: allForks.BeaconState): Buffer {
    return this.config.getForkTypes(value.slot).BeaconState.serialize(value) as Buffer;
  }

  decodeValue(data: Buffer): TreeBacked<allForks.BeaconState> {
    return getStateTypeFromBytes(this.config, data).createTreeBackedFromBytes(data);
  }

  // Handle key as slot

  async put(key: Slot, value: TreeBacked<allForks.BeaconState>): Promise<void> {
    await Promise.all([super.put(key, value), storeRootIndex(this.db, key, value.hashTreeRoot())]);
  }

  getId(state: TreeBacked<allForks.BeaconState>): Epoch {
    return state.slot;
  }

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getByRoot(stateRoot: Root): Promise<TreeBacked<allForks.BeaconState> | null> {
    const slot = await this.getSlotByRoot(stateRoot);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  private async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getRootIndexKey(root));
    return value && bytesToInt(value, "be");
  }
}
