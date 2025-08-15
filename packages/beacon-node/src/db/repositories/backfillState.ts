import {ContainerType, ListBasicType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {DatabaseController, Repository} from "@lodestar/db";
import {ForkName, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {BACKFILL_RANGE_KEY} from "../single/backfillRange.js";

export const epochBackfillStateSSZ = new ContainerType(
  {
    hasBlock: ssz.Boolean,
    hasBlobs: ssz.Boolean,
    columnIndices: new ListBasicType(ssz.ColumnIndex, NUMBER_OF_COLUMNS),
  },
  {typeName: "EpochBackfillState", jsonCase: "eth2"}
);
export type EpochBackfillStateWrapper = ValueOf<typeof epochBackfillStateSSZ>;
export type EpochBackfillState = {
  hasBlock: boolean;
  hasBlobs: boolean | null;
  columnIndices: number[] | null;
};

export class BackfillState extends Repository<Epoch, EpochBackfillStateWrapper> {
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

  async _get(epoch: Epoch): Promise<EpochBackfillState | null> {
    const wrappedValue = await super.get(epoch);
    if (!wrappedValue) return null;
    return this.unwrapEpochBackfillState(wrappedValue, epoch);
  }

  async _put(epoch: Epoch, value: EpochBackfillState): Promise<void> {
    const wrappedValue = this.wrapEpochBackfillState(value);
    await super.put(epoch, wrappedValue);
  }

  private unwrapEpochBackfillState(value: EpochBackfillStateWrapper, epoch: Epoch): EpochBackfillState {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(epoch));
    return {
      hasBlock: value.hasBlock,
      hasBlobs: this.shouldIncludeBlobs(fork) ? value.hasBlobs : null,
      columnIndices: this.shouldIncludeCustodyColumns(fork) ? value.columnIndices : null,
    };
  }

  private wrapEpochBackfillState(value: EpochBackfillState): EpochBackfillStateWrapper {
    return {
      hasBlock: value.hasBlock,
      // Using default values for fields that don't exist in the fork at the epoch
      hasBlobs: value.hasBlobs ?? false,
      columnIndices: value.columnIndices ?? [],
    };
  }

  private shouldIncludeBlobs(fork: ForkName): boolean {
    return fork >= ForkName.deneb;
  }

  private shouldIncludeCustodyColumns(fork: ForkName): boolean {
    return fork >= ForkName.fulu;
  }
}
