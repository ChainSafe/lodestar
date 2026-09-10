import {ChainForkConfig} from "@lodestar/config";
import {Db, DbBatch, FilterOptions, KeyValue, Repository, encodeKey} from "@lodestar/db";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {Logger, bytesToInt, intToBytes} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
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

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends Repository<Slot, SignedBeaconBlock> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blockArchive;
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  /** Backfill Fulu+ slot roots before starting archive writers or serving data-column requests. */
  async init(logger: Logger): Promise<void> {
    // The empty key is metadata; slots always have an eight-byte key.
    const progressKey = encodeKey(Bucket.index_mainChain, new Uint8Array());
    const progress = await this.db.get(progressKey);
    if (progress?.length === 1) return;

    const batchSize = 1000;
    if (progress === null) {
      let keys: Uint8Array[] = [];
      for await (const key of this.db.keysStream({
        gte: progressKey,
        lt: encodeKey(Bucket.index_mainChain + 1, new Uint8Array()),
      })) {
        keys.push(key);
        if (keys.length >= batchSize) {
          await this.db.batchDelete(keys);
          keys = [];
        }
      }
      if (keys.length > 0) await this.db.batchDelete(keys);
    }

    const lastIndexedSlot = progress === null ? null : bytesToInt(progress, "be");
    logger.info("Building archive block root index", {lastIndexedSlot});
    let batch: DbBatch<Uint8Array, Uint8Array> = [];
    let indexedSlots = 0;
    let lastLoggedAt = Date.now();
    const firstSlot = this.config.FULU_FORK_EPOCH * SLOTS_PER_EPOCH;
    const entries = Number.isFinite(firstSlot)
      ? this.binaryEntriesStream({gte: Math.max(firstSlot, lastIndexedSlot === null ? 0 : lastIndexedSlot + 1)})
      : [];
    for await (const {key, value} of entries) {
      const slot = this.decodeKey(key);
      const block = this.decodeValue(value);
      const root = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
      batch.push({type: "put", key: getSlotIndexKey(slot), value: root});
      indexedSlots++;
      if (batch.length >= batchSize) {
        batch.push({type: "put", key: progressKey, value: intToBytes(slot, 8, "be")});
        await this.db.batch(batch);
        batch = [];
        if (Date.now() - lastLoggedAt >= 10_000) {
          logger.info("Building archive block root index", {indexedSlots, lastIndexedSlot: slot});
          lastLoggedAt = Date.now();
        }
      }
    }
    batch.push({type: "put", key: progressKey, value: Uint8Array.of(1)});
    await this.db.batch(batch);
    logger.info("Archive block root index ready", {indexedSlots});
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

  /** Startup backfills Fulu onward; all subsequent archive writes are indexed. */
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
