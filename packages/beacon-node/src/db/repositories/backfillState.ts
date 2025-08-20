import {ContainerType, ListBasicType, OptionalType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {Epoch, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {BACKFILL_RANGE_KEY} from "../single/backfillRange.js";

export const epochBackfillStateSSZ = new ContainerType(
  {
    hasBlock: ssz.Boolean,
    hasBlobs: new OptionalType(ssz.Boolean),
    columnIndices: new OptionalType(new ListBasicType(ssz.ColumnIndex, NUMBER_OF_COLUMNS)),
  },
  {typeName: "EpochBackfillState", jsonCase: "eth2"}
);
export type EpochBackfillState = ValueOf<typeof epochBackfillStateSSZ>;

export class BackfillState extends Repository<Epoch, EpochBackfillState> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.backfill_state;
    super(config, db, bucket, epochBackfillStateSSZ, getBucketNameByValue(bucket));
  }

  encodeKey(key: Epoch): Uint8Array {
    if (key === BACKFILL_RANGE_KEY) {
      throw new Error("Reserved key for backfill range singleton object");
    }
    return super.encodeKey(key);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
