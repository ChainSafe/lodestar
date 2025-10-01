import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository, decodeNumberForDbKey, encodeNumberForDbKey} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Slot, fulu, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const COLUMN_INDEX_BYTE_SIZE = 2;
const SLOT_BYTE_SIZE = 8;

/**
 * DataColumnSidecarsRepository
 * Used to store `finalized` DataColumnSidecars
 *
 * Indexed data by `slot` + `columnIndex`
 */
export class DataColumnSidecarArchiveRepository extends PrefixedRepository<Slot, ColumnIndex, fulu.DataColumnSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.fulu_dataColumnSidecarsArchive;
    super(config, db, bucket, ssz.fulu.DataColumnSidecar, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: fulu.DataColumnSidecar): ColumnIndex {
    return value.index;
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
}
