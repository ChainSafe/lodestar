import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Epoch, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {Db, Bucket, Repository, IDbMetrics} from "@chainsafe/lodestar-db";
import {getStateTypeFromBytes} from "../../util/multifork.js";
import {getRootIndexKey, storeRootIndex} from "./stateArchiveIndex.js";

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */

export class StateArchiveRepository extends Repository<Slot, BeaconStateAllForks> {
  constructor(config: IChainForkConfig, db: Db, metrics?: IDbMetrics) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const type = ssz.phase0.BeaconState as any;
    super(config, db, Bucket.allForks_stateArchive, type, metrics);
  }

  // Overrides for multi-fork

  encodeValue(value: BeaconStateAllForks): Uint8Array {
    return value.serialize();
  }

  decodeValue(data: Uint8Array): BeaconStateAllForks {
    return getStateTypeFromBytes(this.config, data).deserializeToViewDU(data);
  }

  // Handle key as slot

  async put(key: Slot, value: BeaconStateAllForks): Promise<void> {
    await Promise.all([super.put(key, value), storeRootIndex(this.db, key, value.hashTreeRoot())]);
  }

  getId(state: BeaconStateAllForks): Epoch {
    return state.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getByRoot(stateRoot: Root): Promise<BeaconStateAllForks | null> {
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
