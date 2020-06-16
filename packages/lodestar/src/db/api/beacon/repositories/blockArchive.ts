import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToBigInt} from "@chainsafe/lodestar-utils";

import {IDatabaseController, IFilterOptions} from "../../../controller";
import {Bucket} from "../../schema";
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

  public decodeKey(data: Buffer): bigint {
    return bytesToBigInt(super.decodeKey(data) as unknown as Uint8Array, "be");
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
      this.decodeKey(dbFilterOpts.gt) + 1n :
      this.decodeKey(dbFilterOpts.gte);
    const valuesStream = super.valuesStream(opts);
    const step = opts && opts.step || 1;
    return (async function* () {
      for await (const value of valuesStream) {
        if (Number(value.message.slot - firstSlot) % step === 0) {
          yield value;
        }
      }
    })();
  }
}
