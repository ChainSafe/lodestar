import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, IFilterOptions, IKeyValue, Repository} from "@chainsafe/lodestar-db";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {allForks, Slot} from "@chainsafe/lodestar-types";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {ArrayLike, ContainerType} from "@chainsafe/ssz";
import all from "it-all";
import {deleteParentRootIndex, deleteRootIndex, storeParentRootIndex, storeRootIndex} from "./db-index";

export interface IBlockFilterOptions extends IFilterOptions<Slot> {
  step?: number;
}

export interface IKeyValueSummary<K, V, S> extends IKeyValue<K, V> {
  summary: S;
}

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class GenericBlockArchiveRepository extends Repository<Slot, allForks.SignedBeaconBlock> {
  protected type: ContainerType<allForks.SignedBeaconBlock>;

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    bucket: Bucket,
    type: ContainerType<allForks.SignedBeaconBlock>
  ) {
    //casting should be fixed once complex and basic types inherit from Type
    super(config, db, bucket, type);
    this.type = type;
  }

  public async put(key: Slot, value: allForks.SignedBeaconBlock): Promise<void> {
    const blockRoot = this.type.fields["message"].hashTreeRoot(value.message);
    const slot = value.message.slot;
    await Promise.all([
      super.put(key, value),
      storeRootIndex(this.db, slot, blockRoot),
      storeParentRootIndex(this.db, slot, value.message.parentRoot),
    ]);
  }

  public async batchPut(items: ArrayLike<IKeyValue<Slot, allForks.SignedBeaconBlock>>): Promise<void> {
    await Promise.all([
      super.batchPut(items),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const blockRoot = this.type.fields["message"].hashTreeRoot(item.value.message);
        return storeRootIndex(this.db, slot, blockRoot);
      }),
      Array.from(items).map((item) => {
        const slot = item.value.message.slot;
        const parentRoot = item.value.message.parentRoot;
        return storeParentRootIndex(this.db, slot, parentRoot);
      }),
    ]);
  }

  public async batchPutBinary(items: ArrayLike<IKeyValueSummary<Slot, Buffer, IBlockSummary>>): Promise<void> {
    await Promise.all([
      super.batchPutBinary(items),
      Array.from(items).map((item) => storeRootIndex(this.db, item.summary.slot, item.summary.blockRoot)),
      Array.from(items).map((item) => storeParentRootIndex(this.db, item.summary.slot, item.summary.parentRoot)),
    ]);
  }

  public async remove(value: allForks.SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.remove(value),
      deleteRootIndex(this.db, this.type, value),
      deleteParentRootIndex(this.db, value),
    ]);
  }

  public async batchRemove(values: ArrayLike<allForks.SignedBeaconBlock>): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      Array.from(values).map((value) => deleteRootIndex(this.db, this.type, value)),
      Array.from(values).map((value) => deleteParentRootIndex(this.db, value)),
    ]);
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }

  public getId(value: allForks.SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  public async values(opts?: IBlockFilterOptions): Promise<allForks.SignedBeaconBlock[]> {
    return all(this.valuesStream(opts));
  }

  public async *valuesStream(opts?: IBlockFilterOptions): AsyncIterable<allForks.SignedBeaconBlock> {
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
}
