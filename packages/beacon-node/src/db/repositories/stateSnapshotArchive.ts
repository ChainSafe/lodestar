import {BeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, Root, RootHex, Slot, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {bytesToInt, toHex} from "@lodestar/utils";
import {Db, Repository} from "@lodestar/db";
import {getStateTypeFromBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getRootIndexKey, storeRootIndex} from "./stateArchiveIndex.js";

export class StateSnapshotArchiveRepository extends Repository<Slot, BeaconStateAllForks> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const type = ssz.phase0.BeaconState as any;
    const bucket = Bucket.allForks_stateArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
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
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getByRoot(stateRoot: Root): Promise<BeaconStateAllForks | null> {
    const slot = await this.getSlotByRoot(stateRoot);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  async dumpRootIndexEntries(): Promise<{root: RootHex; slot: Slot}[]> {
    const entries = await this.db.entries({
      lte: getRootIndexKey(Buffer.alloc(32, 0xff)),
      gte: getRootIndexKey(Buffer.alloc(32, 0x00)),
    });
    return entries.map((entry) => ({
      root: toHex(entry.key),
      slot: bytesToInt(entry.value, "be"),
    }));
  }

  private async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getRootIndexKey(root));
    return value && bytesToInt(value, "be");
  }
}
