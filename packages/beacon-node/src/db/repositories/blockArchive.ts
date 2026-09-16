import {ChainForkConfig} from "@lodestar/config";
import {Db, DbBatch, FilterOptions, KeyValue, Repository} from "@lodestar/db";
import {Root, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {bytesToInt, fromHex, intToBytes} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
import {getParentRootFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {
  deleteParentRootIndex,
  deleteRootIndex,
  getParentRootIndex,
  getParentRootIndexKey,
  getRootIndex,
  getRootIndexKey,
  getSlotIndexKey,
} from "./blockArchiveIndex.js";

export interface BlockFilterOptions extends FilterOptions<Slot> {
  step?: number;
}

export type BlockArchiveBatchPutBinaryItem = KeyValue<Slot, Uint8Array> & {
  slot: Slot;
  blockRoot: Root;
  parentRoot: Root;
};

const DELETE_RANGE_CHUNK_SIZE = 1000;

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends Repository<Slot, SignedBeaconBlock> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blockArchive;
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  // Overrides for multi-fork

  encodeValue(value: SignedBeaconBlock): Uint8Array {
    return this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value);
  }

  decodeValue(data: Uint8Array): SignedBeaconBlock {
    return getSignedBlockTypeFromBytes(this.config, data).deserialize(data);
  }

  // Handle key as slot

  getId(value: SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Overrides to index

  async put(key: Slot, value: SignedBeaconBlock): Promise<void> {
    await this.batchPut([{key, value}]);
  }

  async putBinary(key: Slot, value: Uint8Array): Promise<void> {
    const block = this.decodeValue(value);
    await this.batchPutBinary([
      {
        key,
        value,
        slot: block.message.slot,
        blockRoot: this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
        parentRoot: block.message.parentRoot,
      },
    ]);
  }

  async batchPut(items: KeyValue<Slot, SignedBeaconBlock>[]): Promise<void> {
    await this.batchPutBinary(
      items.map(({key, value}) => ({
        key,
        value: this.encodeValue(value),
        slot: value.message.slot,
        blockRoot: this.config.getForkTypes(value.message.slot).BeaconBlock.hashTreeRoot(value.message),
        parentRoot: value.message.parentRoot,
      }))
    );
  }

  async batchPutBinary(items: BlockArchiveBatchPutBinaryItem[]): Promise<void> {
    await this.db.batchPut(
      items.flatMap((item) => this.indexedBlockEntries(item)),
      this.dbReqOpts
    );
  }

  async delete(slot: Slot): Promise<void> {
    await this.batchDelete([slot]);
  }

  async batchDelete(slots: Slot[]): Promise<void> {
    await this.db.batchDelete(
      slots.flatMap((slot) => [this.encodeKey(slot), getSlotIndexKey(slot)]),
      this.dbReqOpts
    );
  }

  /**
   * Delete a contiguous range of archived blocks together with their index entries.
   * `slots` must be every archived slot in the range, so the parent of each block is the entry before it.
   */
  async batchDeleteRange(slots: Slot[]): Promise<void> {
    const sorted = [...slots].sort((a, b) => a - b);
    let prevRoot: Root | null = null;

    for (let i = 0; i < sorted.length; i += DELETE_RANGE_CHUNK_SIZE) {
      const chunk = sorted.slice(i, i + DELETE_RANGE_CHUNK_SIZE);
      const roots = await Promise.all(chunk.map((slot) => this.getRootBySlot(slot)));

      const keys: Uint8Array[] = [];
      for (let j = 0; j < chunk.length; j++) {
        keys.push(this.encodeKey(chunk[j]), getSlotIndexKey(chunk[j]));
        const root = roots[j];
        if (root) keys.push(getRootIndexKey(root));
        // The parent index entry pointing at this block is keyed by its parent root, which is the
        // previous block's root unless that block is unindexed, then it is read from the block itself
        let parentRoot = prevRoot;
        if (parentRoot === null) {
          const block = await this.getBinary(chunk[j]);
          const parentRootHex = block ? getParentRootFromSignedBeaconBlockSerialized(block) : null;
          parentRoot = parentRootHex ? fromHex(parentRootHex) : null;
        }
        if (parentRoot) keys.push(getParentRootIndexKey(parentRoot));
        prevRoot = root;
      }
      await this.db.batchDelete(keys, this.dbReqOpts);
    }
  }

  async batch(operations: DbBatch<Slot, SignedBeaconBlock>): Promise<void> {
    await this.batchBinary(
      operations.map((operation) =>
        operation.type === "put" ? {...operation, value: this.encodeValue(operation.value)} : operation
      )
    );
  }

  async batchBinary(operations: DbBatch<Slot, Uint8Array>): Promise<void> {
    const batch: DbBatch<Uint8Array, Uint8Array> = [];
    for (const operation of operations) {
      if (operation.type === "del") {
        batch.push(
          {type: "del", key: this.encodeKey(operation.key)},
          {type: "del", key: getSlotIndexKey(operation.key)}
        );
      } else {
        const block = this.decodeValue(operation.value);
        const entries = this.indexedBlockEntries({
          key: operation.key,
          value: operation.value,
          slot: block.message.slot,
          blockRoot: this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message),
          parentRoot: block.message.parentRoot,
        });
        batch.push(...entries.map((entry) => ({type: "put" as const, ...entry})));
      }
    }
    await this.db.batch(batch, this.dbReqOpts);
  }

  private indexedBlockEntries(item: BlockArchiveBatchPutBinaryItem): KeyValue<Uint8Array, Uint8Array>[] {
    const slotBytes = intToBytes(item.slot, 8, "be");
    return [
      {key: this.encodeKey(item.key), value: item.value},
      {key: getRootIndexKey(item.blockRoot), value: slotBytes},
      {key: getParentRootIndexKey(item.parentRoot), value: slotBytes},
      {key: getSlotIndexKey(item.key), value: item.blockRoot},
    ];
  }

  async remove(value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.remove(value),
      deleteRootIndex(this.db, this.config.getForkTypes(value.message.slot).SignedBeaconBlock, value),
      deleteParentRootIndex(this.db, value),
    ]);
  }

  async batchRemove(values: SignedBeaconBlock[]): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      ...values.map((value) =>
        deleteRootIndex(this.db, this.config.getForkTypes(value.message.slot).SignedBeaconBlock, value)
      ),
      ...values.map((value) => deleteParentRootIndex(this.db, value)),
    ]);
  }

  async *valuesStream(opts?: BlockFilterOptions): AsyncIterable<SignedBeaconBlock> {
    const firstSlot = this.getFirstSlot(opts);
    const valuesStream = super.valuesStream(opts);
    const step = opts?.step ?? 1;

    for await (const value of valuesStream) {
      if ((value.message.slot - firstSlot) % step === 0) {
        yield value;
      }
    }
  }

  async values(opts?: BlockFilterOptions): Promise<SignedBeaconBlock[]> {
    return await Array.fromAsync(this.valuesStream(opts));
  }

  // INDEX

  async getByRoot(root: Root): Promise<SignedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? this.get(slot) : null;
  }

  async getBinaryEntryByRoot(root: Root): Promise<KeyValue<Slot, Buffer> | null> {
    const slot = await this.getSlotByRoot(root);
    return slot !== null ? ({key: slot, value: await this.getBinary(slot)} as KeyValue<Slot, Buffer>) : null;
  }

  async getByParentRoot(root: Root): Promise<SignedBeaconBlock | null> {
    const slot = await this.getSlotByParentRoot(root);
    return slot !== null ? this.get(slot) : null;
  }

  async getRootBySlot(slot: Slot): Promise<Root | null> {
    return this.db.get(getSlotIndexKey(slot), {bucketId: getBucketNameByValue(Bucket.index_mainChain)});
  }

  async getSlotByRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await getRootIndex(this.db, root));
  }

  async getSlotByParentRoot(root: Root): Promise<Slot | null> {
    return this.parseSlot(await getParentRootIndex(this.db, root));
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
