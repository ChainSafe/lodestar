import all from "it-all";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository, KeyValue, FilterOptions} from "@lodestar/db";
import {Slot, Root, allForks, ssz, Uint8, isBlindedSignedBeaconBlock, bellatrix} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
import {DATABASE_SERIALIZED_BLINDED_BLOCK_BIT, DATABASE_SERIALIZED_FULL_BLOCK_BIT} from "../../util/sszBytes.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {IExecutionEngine} from "../../execution/index.js";
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
export class BlockArchiveRepository extends Repository<Slot, allForks.FullOrBlindedSignedBeaconBlock> {
  executionEngine?: IExecutionEngine;
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blockArchive;
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  setExecutionEngine(engine: IExecutionEngine): void {
    this.executionEngine = engine;
  }

  // Overrides for multi-fork

  encodeValue(value: allForks.SignedBeaconBlock): Uint8Array {
    return this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value);
  }

  decodeValue(data: Uint8Array): allForks.FullOrBlindedSignedBeaconBlock {
    let isBlinded = false;
    if (data[0] === DATABASE_SERIALIZED_BLINDED_BLOCK_BIT) {
      // reset first bit so deserialize works correctly
      data[0] = DATABASE_SERIALIZED_FULL_BLOCK_BIT as Uint8;
      isBlinded = true;
    }
    return getSignedBlockTypeFromBytes(this.config, data, isBlinded).deserialize(data);
  }

  // Handle key as slot

  getId(value: allForks.FullOrBlindedSignedBeaconBlock): Slot {
    return value.message.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  // Overrides to index

  async get(key: Slot): Promise<allForks.SignedBeaconBlock | null> {
    const value = await super.get(key);
    if (!value) return null;
    return this.fullBlockFromMaybeBlinded(value);
  }

  async getBinary(id: number): Promise<Uint8Array | null> {
    // this is not great to deserialize and reserialize
  }

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
    // TODO: need to deserialize to swap out transactions for transactionRoot.  this was just changed
    // in PR #5573.  Will research further.
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
        yield this.fullBlockFromMaybeBlinded(value);
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

  private async fullBlockFromMaybeBlinded(
    maybeBlinded: allForks.FullOrBlindedSignedBeaconBlock
  ): Promise<allForks.SignedBeaconBlock> {
    if (!isBlindedSignedBeaconBlock(maybeBlinded)) {
      return maybeBlinded;
    }
    if (!this.executionEngine) {
      throw new Error("Execution engine not set");
    }
    const elBlockHash = (maybeBlinded as bellatrix.SignedBlindedBeaconBlock).message.body.executionPayloadHeader
      .blockHash;
    const engineRes = await this.executionEngine.getPayloadBodiesByHash([elBlockHash.toString()]);
    if (!engineRes[0]) {
      throw new Error(`Execution payload not found for slot ${maybeBlinded.message.slot}`);
    }

    const a = ssz[this.config.getForkName(value.message.slot)].SignedBeaconBlock.clone(value);
    a.message.body.executionPayload = engineRes[0];
    // (value as bellatrix.SignedBeaconBlock).message.body.executionPayload = engineRes[0];

    blinded.message.body.executionPayload = elPayload;
    return blinded;
  }
}
