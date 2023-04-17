import all from "it-all";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository, KeyValue, FilterOptions, Bucket} from "@lodestar/db";
import {Slot, Root, allForks, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
import {getRootIndexKey, getParentRootIndexKey} from "./blockArchiveIndex.js";
import {deleteParentRootIndex, deleteRootIndex, storeParentRootIndex, storeRootIndex} from "./blockArchiveIndex.js";

export interface BlockFilterOptions extends FilterOptions<Slot> {
  step?: number;
}

export type BlockArchiveBatchPutBinaryItem = KeyValue<Slot, Uint8Array> & {
  slot: Slot;
  blockRoot: Root;
  parentRoot: Root;
};

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends Repository<Slot, allForks.SignedBeaconBlock> {
  constructor(config: ChainForkConfig, db: Db) {
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, Bucket.allForks_blockArchive, type);
  }

  // Overrides for multi-fork

  encodeValue(value: allForks.SignedBeaconBlock): Uint8Array {
    return this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value) as Uint8Array;
  }

  decodeValue(data: Uint8Array): allForks.SignedBeaconBlock {
    return getSignedBlockTypeFromBytes(this.config, data).deserialize(data);
  }

  // Handle key as slot

  getId(value: allForks.SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Overrides to index

  async put(key: Slot, value: allForks.SignedBeaconBlock): Promise<void> {
    const blockRoot = this.config.getForkTypes(value.message.slot).BeaconBlock.hashTreeRoot(value.message);
    const slot = value.message.slot;
    await Promise.all([
      super.put(key, value),
      storeRootIndex(this.db, slot, blockRoot),
      storeParentRootIndex(this.db, slot, value.message.parentRoot),
    ]);
  }

  async batchPut(items: KeyValue<Slot, allForks.SignedBeaconBlock>[]): Promise<void> {
    await Promise.all([
      super.batchPut(items),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(item.value.message);
        return storeRootIndex(this.db, slot, blockRoot);
      }),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const parentRoot = item.value.message.parentRoot;
        return storeParentRootIndex(this.db, slot, parentRoot);
      }),
    ]);
  }

  async batchPutBinary(items: BlockArchiveBatchPutBinaryItem[]): Promise<void> {
    await Promise.all([
      super.batchPutBinary(items),
      Array.from(items).map((item) => storeRootIndex(this.db, item.slot, item.blockRoot)),
      Array.from(items).map((item) => storeParentRootIndex(this.db, item.slot, item.parentRoot)),
    ]);
  }

  async remove(value: allForks.SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.remove(value),
      deleteRootIndex(this.db, this.config.getForkTypes(value.message.slot).SignedBeaconBlock, value),
      deleteParentRootIndex(this.db, value),
    ]);
  }

  async batchRemove(values: allForks.SignedBeaconBlock[]): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      Array.from(values).map((value) =>
        deleteRootIndex(this.db, this.config.getForkTypes(value.message.slot).SignedBeaconBlock, value)
      ),
      Array.from(values).map((value) => deleteParentRootIndex(this.db, value)),
    ]);
  }

  async *valuesStream(opts?: BlockFilterOptions): AsyncIterable<allForks.SignedBeaconBlock> {
    const firstSlot = this.getFirstSlot(opts);
    const valuesStream = super.valuesStream(opts);
    const step = (opts && opts.step) ?? 1;

    for await (const value of valuesStream) {
      if ((value.message.slot - firstSlot) % step === 0) {
        yield value;
      }
    }
  }

  async values(opts?: BlockFilterOptions): Promise<allForks.SignedBeaconBlock[]> {
    return all(this.valuesStream(opts));
  }

  // INDEX

  async getByRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? this.get(slot) : null;
  }

  async getBinaryEntryByRoot(root: Root): Promise<KeyValue<Slot, Buffer> | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? ({key: slot, value: await this.getBinary(slot)} as KeyValue<Slot, Buffer>) : null;
  }

  async getByParentRoot(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const slot = await this.getSlotByParentRoot(root);
    return slot !== null ? this.get(slot) : null;
  }

  async getSlotByRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await this.db.get(getRootIndexKey(root)));
  }

  async getSlotByParentRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await this.db.get(getParentRootIndexKey(root)));
  }

  private parseSlot(slotBytes: Uint8Array | null): Slot | null {
    if (!slotBytes) return null;
    const slot = bytesToInt(slotBytes, "be");
    // TODO: Is this necessary? How can bytesToInt return a non-integer?
    return Number.isInteger(slot) ? slot : null;
  }

  private getFirstSlot(opts?: BlockFilterOptions): Slot {
    const dbFilterOpts = this.dbFilterOptions(opts);
    const firstSlot = dbFilterOpts.gt
      ? this.decodeKey(dbFilterOpts.gt) + 1
      : dbFilterOpts.gte
      ? this.decodeKey(dbFilterOpts.gte)
      : null;
    if (firstSlot === null) throw Error("specify opts.gt or opts.gte");

    return firstSlot;
  }
}
