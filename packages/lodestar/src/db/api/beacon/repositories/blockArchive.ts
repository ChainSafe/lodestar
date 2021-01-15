import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, encodeKey, IDatabaseController, IFilterOptions, IKeyValue, Repository} from "@chainsafe/lodestar-db";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";
import {ArrayLike} from "@chainsafe/ssz";
import all from "it-all";

export interface IBlockFilterOptions extends IFilterOptions<Slot> {
  step?: number;
}

export interface IKeyValueSummary<K, V, S> extends IKeyValue<K, V> {
  summary: S;
}

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends Repository<Slot, SignedBeaconBlock> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.blockArchive, config.types.SignedBeaconBlock);
  }

  public async put(key: Slot, value: SignedBeaconBlock): Promise<void> {
    const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(value.message);
    const slot = value.message.slot;
    await Promise.all([
      super.put(key, value),
      this.storeRootIndex(slot, blockRoot),
      this.storeParentRootIndex(slot, value.message.parentRoot),
    ]);
  }

  public async batchPut(items: ArrayLike<IKeyValue<Slot, SignedBeaconBlock>>): Promise<void> {
    await Promise.all([
      super.batchPut(items),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const blockRoot = this.config.types.BeaconBlock.hashTreeRoot(item.value.message);
        return this.storeRootIndex(slot, blockRoot);
      }),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const parentRoot = item.value.message.parentRoot;
        return this.storeParentRootIndex(slot, parentRoot);
      }),
    ]);
  }

  public async batchPutBinary(items: ArrayLike<IKeyValueSummary<Slot, Buffer, IBlockSummary>>): Promise<void> {
    await Promise.all([
      super.batchPutBinary(items),
      Array.from(items).map((item) => this.storeRootIndex(item.summary.slot, item.summary.blockRoot)),
      Array.from(items).map((item) => this.storeParentRootIndex(item.summary.slot, item.summary.parentRoot)),
    ]);
  }

  public async remove(value: SignedBeaconBlock): Promise<void> {
    await Promise.all([super.remove(value), this.deleteRootIndex(value), this.deleteParentRootIndex(value)]);
  }

  public async batchRemove(values: ArrayLike<SignedBeaconBlock>): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      Array.from(values).map((value) => this.deleteRootIndex(value)),
      Array.from(values).map((value) => this.deleteParentRootIndex(value)),
    ]);
  }

  public async getByRoot(root: Root): Promise<SignedBeaconBlock | null> {
    const slot = await this.getSlotByRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  public async getByParentRoot(root: Root): Promise<SignedBeaconBlock | null> {
    const slot = await this.getSlotByParentRoot(root);
    if (slot !== null && Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  public async getSlotByRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(this.getRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public async getSlotByParentRoot(root: Root): Promise<Slot | null> {
    const value = await this.db.get(this.getParentRootIndexKey(root));
    if (value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  public getId(value: SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  public async values(opts?: IBlockFilterOptions): Promise<SignedBeaconBlock[]> {
    return all(this.valuesStream(opts));
  }

  public async *valuesStream(opts?: IBlockFilterOptions): AsyncIterable<SignedBeaconBlock> {
    const dbFilterOpts = this.dbFilterOptions(opts);
    const firstSlot = dbFilterOpts.gt
      ? this.decodeKey(dbFilterOpts.gt) + 1
      : dbFilterOpts.gte
      ? this.decodeKey(dbFilterOpts.gte)
      : null;
    if (firstSlot === null) throw Error("specify opts.gt or opts.gte");
    const valuesStream = super.valuesStream(opts);
    const step = (opts && opts.step) || 1;

    for await (const value of valuesStream) {
      if ((value.message.slot - firstSlot) % step === 0) {
        yield value;
      }
    }
  }

  private async storeRootIndex(slot: Slot, blockRoot: Root): Promise<void> {
    return this.db.put(this.getRootIndexKey(blockRoot), intToBytes(slot, 64, "be"));
  }

  private async storeParentRootIndex(slot: Slot, parentRoot: Root): Promise<void> {
    return this.db.put(this.getParentRootIndexKey(parentRoot), intToBytes(slot, 64, "be"));
  }

  private async deleteRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.delete(this.getRootIndexKey(this.config.types.BeaconBlock.hashTreeRoot(block.message)));
  }

  private async deleteParentRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.delete(this.getParentRootIndexKey(block.message.parentRoot));
  }

  private getParentRootIndexKey(parentRoot: Root): Buffer {
    return encodeKey(Bucket.blockArchiveParentRootIndex, parentRoot.valueOf() as Uint8Array);
  }

  private getRootIndexKey(root: Root): Buffer {
    return encodeKey(Bucket.blockArchiveRootIndex, root.valueOf() as Uint8Array);
  }
}
