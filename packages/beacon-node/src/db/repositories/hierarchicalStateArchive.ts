import {Epoch, Root, RootHex, Slot, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {bytesToInt, toHex} from "@lodestar/utils";
import {Db, Repository} from "@lodestar/db";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {getRootIndexKey, storeRootIndex} from "./stateArchiveIndex.js";
import {BooleanType, ByteListType, ContainerType, UintNumberType, ValueOf} from "@chainsafe/ssz";

export const StateArchiveSSZType = new ContainerType({
  snapshot: new BooleanType(),
  slot: new UintNumberType(8),
  stateRoot: ssz.Root,
  partialState: new ByteListType(1_073_741_824),
  balances: new ByteListType(1_073_741_824),
});

export type StateArchive = ValueOf<typeof StateArchiveSSZType>;

/**
 * We will use `stateArchive` to store legacy state full dump or new archive structure
 */
export class HierarchicalStateArchiveRepository extends Repository<Slot, StateArchive> {
  constructor(config: ChainForkConfig, db: Db) {
    // Pick some type but won't be used. Casted to any because no type can match `BeaconStateAllForks`
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const type = StateArchiveSSZType as any;
    const bucket = Bucket.allForks_hierarchicalStateArchive;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Handle key as slot
  async put(key: Slot, value: StateArchive): Promise<void> {
    await Promise.all([super.put(key, value), storeRootIndex(this.db, key, value.stateRoot)]);
  }

  getId(value: StateArchive): Epoch {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Index Root -> Slot

  async getByRoot(stateRoot: Root): Promise<StateArchive | null> {
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
