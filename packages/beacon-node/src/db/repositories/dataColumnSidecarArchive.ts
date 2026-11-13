import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository, decodeNumberForDbKey, encodeNumberForDbKey} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, DataColumnSidecar, Slot, isGloasDataColumnSidecar, ssz} from "@lodestar/types";
import {isGloasDataColumnSidecarBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const COLUMN_INDEX_BYTE_SIZE = 2;
const SLOT_BYTE_SIZE = 8;

/**
 * DataColumnSidecarsRepository
 * Used to store `finalized` DataColumnSidecars
 *
 * Indexed data by `slot` + `columnIndex`
 */
export class DataColumnSidecarArchiveRepository extends PrefixedRepository<Slot, ColumnIndex, DataColumnSidecar> {
  private prunedBeforeSlot: Slot | null = null;

  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_dataColumnSidecarsArchive;
    // Type won't be used since we select it dynamically based on fork
    const type = ssz.fulu.DataColumnSidecar;
    super(config, db, bucket, type, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: DataColumnSidecar): ColumnIndex {
    return value.index;
  }

  encodeValue(value: DataColumnSidecar): Uint8Array {
    if (isGloasDataColumnSidecar(value)) {
      return ssz.gloas.DataColumnSidecar.serialize(value);
    }
    return ssz.fulu.DataColumnSidecar.serialize(value);
  }

  decodeValue(data: Uint8Array): DataColumnSidecar {
    if (isGloasDataColumnSidecarBytes(data)) {
      return ssz.gloas.DataColumnSidecar.deserialize(data);
    }
    return ssz.fulu.DataColumnSidecar.deserialize(data);
  }

  encodeKeyRaw(prefix: Slot, id: ColumnIndex): Uint8Array {
    return Buffer.concat([
      encodeNumberForDbKey(prefix, SLOT_BYTE_SIZE),
      encodeNumberForDbKey(id, COLUMN_INDEX_BYTE_SIZE),
    ]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: Slot; id: ColumnIndex} {
    return {
      prefix: decodeNumberForDbKey(raw, SLOT_BYTE_SIZE) as Slot,
      id: decodeNumberForDbKey(raw.slice(SLOT_BYTE_SIZE), COLUMN_INDEX_BYTE_SIZE) as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([
      encodeNumberForDbKey(prefix, SLOT_BYTE_SIZE),
      encodeNumberForDbKey(NUMBER_OF_COLUMNS - 1, COLUMN_INDEX_BYTE_SIZE),
    ]);
  }

  getMinKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([
      encodeNumberForDbKey(prefix, SLOT_BYTE_SIZE),
      encodeNumberForDbKey(0, COLUMN_INDEX_BYTE_SIZE),
    ]);
  }

  /**
   * Deletes all entries before `slot`. Prunes only delete from the start of the bucket, so the first prune
   * compacts the range to drop tombstones of earlier runs and later prunes resume where the previous one ended.
   */
  async pruneBefore(slot: Slot): Promise<Slot[]> {
    if (this.prunedBeforeSlot === null) {
      await this.db.compactRange(this.wrapKey(this.getMinKeyRaw(0)), this.wrapKey(this.getMinKeyRaw(slot)));
    } else if (slot <= this.prunedBeforeSlot) {
      return [];
    }

    const keys = await this.keys({gte: {prefix: this.prunedBeforeSlot ?? 0, id: 0}, lt: {prefix: slot, id: 0}});
    const slots = [...new Set(keys.map(({prefix}) => prefix))];
    if (slots.length > 0) await this.deleteMany(slots);
    this.prunedBeforeSlot = slot;
    return slots;
  }
}
