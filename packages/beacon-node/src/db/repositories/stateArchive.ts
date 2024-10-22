import {BeaconStateAllForks} from "@lodestar/state-transition";
import {Epoch, Root, RootHex, Slot, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {bytesToInt, toHex} from "@lodestar/utils";
import {Db, Repository} from "@lodestar/db";
import {getStateTypeFromBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getRootIndexKey, storeRootIndex} from "./stateArchiveIndex.js";

export class StateArchiveRepository extends Repository<Slot, Uint8Array> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = ssz.phase0.BeaconState as any;
    const bucket = Bucket.allForks_stateArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork

  encodeValue(_value: Uint8Array): Uint8Array {
    throw new Error("Non supported");
  }

  decodeValue(_data: Uint8Array): Uint8Array {
    throw new Error("Non supported");
  }

  // Handle key as slot

  async put(_key: Slot, _value: Uint8Array): Promise<void> {
    throw new Error("Non supported");
  }

  getId(_state: Uint8Array): Epoch {
    throw new Error("Non supported");
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getByRoot(stateRoot: Root): Promise<Uint8Array | null> {
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

  async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(getRootIndexKey(root));
    return value && bytesToInt(value, "be");
  }
}
