import {Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt, intToBytes} from "@chainsafe/lodestar-utils";

import {IDatabaseController, IFilterOptions} from "../../../controller";
import {Bucket, encodeKey} from "../../schema";
import {Repository} from "./abstract";
import {ArrayLike} from "@chainsafe/ssz";

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

  public async add(value: SignedBeaconBlock): Promise<void> {
    await Promise.all([
      super.add(value),
      this.storeRootRef(value)
    ]);
  }

  public async getByRoot(root: Root): Promise<SignedBeaconBlock|null> {
    const slot = await this.getSlotByRoot(root);
    if(slot && slot !== 0) {
      return this.get(slot);
    }
    return null;
  }

  public async getSlotByRoot(root: Root): Promise<Slot> {
    const value = await this.db.get(
      encodeKey(
        Bucket.blockArchiveRootRef,
        root.valueOf() as Uint8Array
      )
    );
    if(value) {
      return bytesToInt(value, "be");
    }
    return null;
  }


  public async batchAdd(values: ArrayLike<SignedBeaconBlock>): Promise<void> {
    await Promise.all([
      super.batchAdd(values),
      ...Array.from(values).map((block) => this.storeRootRef(block))
    ]);
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

  private async storeRootRef(block: SignedBeaconBlock): Promise<void> {
    return this.db.put(
      encodeKey(
        Bucket.blockArchiveRootRef,
        this.config.types.BeaconBlock.hashTreeRoot(block.message)
      ),
      intToBytes(block.message.slot, 64, "be")
    );
  }
}
