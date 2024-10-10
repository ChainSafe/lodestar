import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {RootHex, Slot, ssz} from "@lodestar/types";
import {bytesToInt, toHex} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getRootIndexKey} from "./stateArchiveIndex.js";

export class StateDiffArchiveRepository extends Repository<Slot, Uint8Array> {
  constructor(config: ChainForkConfig, db: Db) {
    // TODO: Create and use use proper SSZ type for diff object
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const type = ssz.phase0.BeaconState as any;
    const bucket = Bucket.allForks_stateDiffArchive;

    // TODO: REmove the type support
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

  getId(_state: Uint8Array): Slot {
    throw new Error("Non supported");
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
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
}
