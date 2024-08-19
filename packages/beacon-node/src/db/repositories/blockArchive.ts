import all from "it-all";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository, KeyValue, FilterOptions} from "@lodestar/db";
import {Slot, Root, ssz, SignedBeaconBlock, SignedBlindedBeaconBlock} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {blindedOrFullBlockHashTreeRoot, fullOrBlindedSignedBlockToBlinded} from "@lodestar/state-transition";
import {
  serializeFullOrBlindedSignedBeaconBlock,
  deserializeFullOrBlindedSignedBeaconBlock,
} from "../../util/fullOrBlindedBlock.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
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
export class BlockArchiveRepository extends Repository<Slot, SignedBeaconBlock | SignedBlindedBeaconBlock> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blockArchive;
    // Pick some type but won't be used, override below so correct container is used
    const type = ssz.phase0.SignedBeaconBlock;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork

  encodeValue(value: SignedBeaconBlock | SignedBlindedBeaconBlock): Uint8Array {
    return serializeFullOrBlindedSignedBeaconBlock(this.config, value);
  }

  decodeValue(data: Uint8Array): SignedBeaconBlock | SignedBlindedBeaconBlock {
    return deserializeFullOrBlindedSignedBeaconBlock(this.config, data);
  }

  // Handle key as slot

  getId(value: SignedBeaconBlock | SignedBlindedBeaconBlock): Slot {
    return value.message.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Overrides to index

  async put(key: Slot, value: SignedBeaconBlock | SignedBlindedBeaconBlock): Promise<void> {
    const blockRoot = blindedOrFullBlockHashTreeRoot(this.config, value.message);
    const slot = value.message.slot;
    await Promise.all([
      super.put(key, value),
      storeRootIndex(this.db, slot, blockRoot),
      storeParentRootIndex(this.db, slot, value.message.parentRoot),
    ]);
  }

  async batchPut(items: KeyValue<Slot, SignedBeaconBlock | SignedBlindedBeaconBlock>[]): Promise<void> {
    await Promise.all([
      super.batchPut(
        items.map(({key, value}) => ({key, value: fullOrBlindedSignedBlockToBlinded(this.config, value)}))
      ),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const blockRoot = blindedOrFullBlockHashTreeRoot(this.config, item.value.message);
        return storeRootIndex(this.db, slot, blockRoot);
      }),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const parentRoot = item.value.message.parentRoot;
        return storeParentRootIndex(this.db, slot, parentRoot);
      }),
    ]);
  }

  // TODO: (@matthewkeil) should this throw or should we allow puts of binary blocks?
  async batchPutBinary(items: BlockArchiveBatchPutBinaryItem[]): Promise<void> {
    await Promise.all([
      super.batchPutBinary(items),
      Array.from(items).map((item) => storeRootIndex(this.db, item.slot, item.blockRoot)),
      Array.from(items).map((item) => storeParentRootIndex(this.db, item.slot, item.parentRoot)),
    ]);
  }

  async remove(value: SignedBeaconBlock | SignedBlindedBeaconBlock): Promise<void> {
    await Promise.all([
      super.remove(value),
      deleteRootIndex(this.db, blindedOrFullBlockHashTreeRoot(this.config, value.message)),
      deleteParentRootIndex(this.db, value),
    ]);
  }

  async batchRemove(values: (SignedBeaconBlock | SignedBlindedBeaconBlock)[]): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      Array.from(values).map((value) =>
        deleteRootIndex(this.db, blindedOrFullBlockHashTreeRoot(this.config, value.message))
      ),
      Array.from(values).map((value) => deleteParentRootIndex(this.db, value)),
    ]);
  }

  async *valuesStream(opts?: BlockFilterOptions): AsyncIterable<SignedBeaconBlock | SignedBlindedBeaconBlock> {
    const firstSlot = this.getFirstSlot(opts);
    const valuesStream = super.valuesStream(opts);
    const step = (opts && opts.step) ?? 1;

    for await (const value of valuesStream) {
      if ((value.message.slot - firstSlot) % step === 0) {
        yield value;
      }
    }
  }

  async values(opts?: BlockFilterOptions): Promise<(SignedBeaconBlock | SignedBlindedBeaconBlock)[]> {
    return all(this.valuesStream(opts));
  }

  // INDEX

  async getByRoot(root: Root): Promise<SignedBeaconBlock | SignedBlindedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? this.get(slot) : null;
  }

  async getBinaryEntryByRoot(root: Root): Promise<KeyValue<Slot, Buffer> | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? ({key: slot, value: await this.getBinary(slot)} as KeyValue<Slot, Buffer>) : null;
  }

  async getByParentRoot(root: Root): Promise<SignedBeaconBlock | SignedBlindedBeaconBlock | null> {
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
