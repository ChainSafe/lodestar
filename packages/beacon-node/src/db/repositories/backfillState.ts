import {ContainerType, ListBasicType, OptionalType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {BACKFILLED_RANGE_KEY} from "../single/backfilledRange.js";

export const backfillStateWrapperSsz = new ContainerType(
  {
    hasBlock: ssz.Boolean,
    hasBlobs: new OptionalType(ssz.Boolean),
    columnIndices: new OptionalType(new ListBasicType(ssz.ColumnIndex, NUMBER_OF_COLUMNS)),
  },
  {typeName: "BackfillStateWrapper", jsonCase: "eth2"}
);
export type BackfillStateWrapper = ValueOf<typeof backfillStateWrapperSsz>;

export class BackfillStateRepository extends Repository<number, BackfillStateWrapper> {
  constructor(config: ChainForkConfig, db: DatabaseController<Uint8Array, Uint8Array>) {
    const bucket = Bucket.backfill_state;
    super(config, db, bucket, backfillStateWrapperSsz, getBucketNameByValue(bucket));
  }

  encodeKey(key: number): Uint8Array {
    if (key === BACKFILLED_RANGE_KEY) {
      throw new Error("Reserved key for backfill range singleton object");
    }
    return super.encodeKey(key);
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
