import {ChainForkConfig} from "@lodestar/config";
import {BinaryRepository, Db} from "@lodestar/db";
import {Root, RootHex, Slot} from "@lodestar/types";
import {bytesToInt, toHex} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getRootIndex, getRootIndexKey, storeRootIndex} from "./stateArchiveIndex.js";

export type BeaconStateArchive = {
  serialize(): Uint8Array;
  hashTreeRoot(): Root;
};

export class StateArchiveRepository extends BinaryRepository<Slot> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_stateArchive;
    super(config, db, bucket, getBucketNameByValue(bucket));
  }

  // Handle key as slot

  async put(key: Slot, value: BeaconStateArchive): Promise<void> {
    await Promise.all([super.putBinary(key, value.serialize()), storeRootIndex(this.db, key, value.hashTreeRoot())]);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getBinaryByRoot(stateRoot: Root): Promise<Uint8Array | null> {
    const slot = await this.getSlotByRoot(stateRoot);
    if (slot !== null && Number.isInteger(slot)) {
      return this.getBinary(slot);
    }
    return null;
  }

  async dumpRootIndexEntries(): Promise<{root: RootHex; slot: Slot}[]> {
    const entries = await this.db.entries({
      lte: getRootIndexKey(Buffer.alloc(32, 0xff)),
      gte: getRootIndexKey(Buffer.alloc(32, 0x00)),
      bucketId: this.bucketId,
    });
    return entries.map((entry) => ({
      root: toHex(entry.key),
      slot: bytesToInt(entry.value, "be"),
    }));
  }

  private async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await getRootIndex(this.db, root);
    return value && bytesToInt(value, "be");
  }
}
