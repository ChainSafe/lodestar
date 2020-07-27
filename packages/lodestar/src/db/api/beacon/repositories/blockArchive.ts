import {Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";

import {IDatabaseController, IFilterOptions, IKeyValue} from "../../../controller";
import {Bucket, encodeKey} from "../../schema";
import {ArrayLike} from "@chainsafe/ssz";
import {Repository} from "./abstract";

export interface IBlockFilterOptions extends IFilterOptions<Slot> {
  step?: number;
}

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends Repository<Slot, SignedBeaconBlock> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.blockArchive, config.types.SignedBeaconBlock);
  }

  public async put(key: Slot, value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.put(key, value),
      this.storeRootIndex(value),
      this.storeParentRootIndex(value)
    ]);
  }

  public async batchPut(items: ArrayLike<IKeyValue<Slot, SignedBeaconBlock>>): Promise<void> {
    await Promise.all([
      super.batchPut(items),
      Array.from(items).map((item) => this.storeRootIndex(item.value)),
      Array.from(items).map((item) => this.storeParentRootIndex(item.value))
    ]);
  }

  public async remove(value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.remove(value),
      this.deleteRootIndex(value),
      this.deleteParentRootIndex(value)
    ]);
  }

  public async batchRemove(values: ArrayLike<SignedBeaconBlock>): Promise<void> {
    await Promise.all([
      super.batchRemove(values),
      Array.from(values).map((value) => this.deleteRootIndex(value)),
      Array.from(values).map((value) => this.deleteParentRootIndex(value))
    ]);
  }

  public async getByRoot(root: Root): Promise<SignedBeaconBlock|null> {
    const slot = await this.getSlotByRoot(root);
    if(Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  public async getByParentRoot(root: Root): Promise<SignedBeaconBlock|null> {
    const slot = await this.getSlotByParentRoot(root);
    if(Number.isInteger(slot)) {
      return this.get(slot);
    }
    return null;
  }

  public async getSlotByRoot(root: Root): Promise<Slot|null> {
    const value = await this.db.get(
      this.getRootIndexKey(root)
    );
    if(value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public async getSlotByParentRoot(root: Root): Promise<Slot|null> {
    const value = await this.db.get(
      this.getParentRootIndexKey(root)
    );
    if(value) {
      return bytesToInt(value, "be");
    }
    return null;
  }

  public decodeKey(data: Buffer): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }

  public getId(value: SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  public async values(opts?: IBlockFilterOptions): Promise<SignedBeaconBlock[]> {
    const result = [];
    for await (const value of this.valuesStream(opts)) {
      result.push(value);
    }
    return result;
  }

  public valuesStream(opts?: IBlockFilterOptions): AsyncIterable<SignedBeaconBlock> {
    const dbFilterOpts = this.dbFilterOptions(opts);
    const firstSlot = dbFilterOpts.gt ?
      this.decodeKey(dbFilterOpts.gt) + 1 :
      this.decodeKey(dbFilterOpts.gte);
    const valuesStream = super.valuesStream(opts);
    const step = opts && opts.step || 1;
    return (async function* () {
      for await (const value of valuesStream) {
        if ((value.message.slot - firstSlot) % step === 0) {
          yield value;
        }
      }
    })();
  }

  private async storeRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.put(
      this.getRootIndexKey(this.config.types.BeaconBlock.hashTreeRoot(block.message)),
      intToBytes(block.message.slot, 64, "be")
    );
  }

  private async storeParentRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.put(
      this.getParentRootIndexKey(block.message.parentRoot),
      intToBytes(block.message.slot, 64, "be")
    );
  }

  private async deleteRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.delete(
      this.getRootIndexKey(this.config.types.BeaconBlock.hashTreeRoot(block.message))
    );
  }

  private async deleteParentRootIndex(block: SignedBeaconBlock): Promise<void> {
    return this.db.delete(
      this.getParentRootIndexKey(block.message.parentRoot)
    );
  }


  private getParentRootIndexKey(parentRoot: Root): Buffer {
    return encodeKey(Bucket.blockArchiveParentRootIndex, parentRoot.valueOf() as Uint8Array);
  }

  private getRootIndexKey(root: Root): Buffer {
    return encodeKey(Bucket.blockArchiveRootIndex, root.valueOf() as Uint8Array);
  }
}
