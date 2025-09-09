import {ChainForkConfig} from "@lodestar/config";
import {Db, decodeNumberForDbKey, encodeNumberForDbKey, PrefixedRepository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Slot, fulu, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const columnIndexByteSize = 2;
const slotByteSize = 8;

/**
 * DataColumnSidecarsRepository
 * Used to store `finalized` DataColumnSidecars
 *
 * Indexed data by `slot` + `columnIndex`
 */
export class DataColumnSidecarArchiveRepository extends PrefixedRepository<Slot, ColumnIndex, fulu.DataColumnSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_dataColumnSidecarsArchive;
    super(config, db, bucket, ssz.fulu.DataColumnSidecar, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: fulu.DataColumnSidecar): ColumnIndex {
    return value.index;
  }

  encodeKeyRaw(prefix: Slot, id: ColumnIndex): Uint8Array {
    return Buffer.concat([encodeNumberForDbKey(prefix, slotByteSize), encodeNumberForDbKey(id, columnIndexByteSize)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: Slot; id: ColumnIndex} {
    return {
      prefix: decodeNumberForDbKey(raw, slotByteSize) as Slot,
      id: decodeNumberForDbKey(raw.slice(slotByteSize), columnIndexByteSize) as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([
      encodeNumberForDbKey(prefix, slotByteSize),
      encodeNumberForDbKey(NUMBER_OF_COLUMNS - 1, columnIndexByteSize),
    ]);
  }

  getMinKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([encodeNumberForDbKey(prefix, slotByteSize), encodeNumberForDbKey(0, columnIndexByteSize)]);
  }
}
