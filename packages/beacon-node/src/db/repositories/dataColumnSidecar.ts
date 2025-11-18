import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository, decodeNumberForDbKey, encodeNumberForDbKey} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Root, fulu, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const COLUMN_INDEX_BYTE_SIZE = 2;
const BLOCK_ROOT_BYTE_SIZE = 32;

type BlockRoot = Root;

/**
 * DataColumnSidecarsRepository
 * Used to store `unfinalized` DataColumnSidecars
 *
 * Indexed data by `blockRoot` + `columnIndex`
 */
export class DataColumnSidecarRepository extends PrefixedRepository<BlockRoot, ColumnIndex, fulu.DataColumnSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.fulu_dataColumnSidecars;
    super(config, db, bucket, ssz.fulu.DataColumnSidecar, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: fulu.DataColumnSidecar): ColumnIndex {
    return value.index;
  }

  encodeKeyRaw(prefix: BlockRoot, id: ColumnIndex): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(id, COLUMN_INDEX_BYTE_SIZE)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: BlockRoot; id: ColumnIndex} {
    return {
      prefix: raw.slice(0, BLOCK_ROOT_BYTE_SIZE) as BlockRoot,
      id: decodeNumberForDbKey(raw.slice(BLOCK_ROOT_BYTE_SIZE), COLUMN_INDEX_BYTE_SIZE) as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(NUMBER_OF_COLUMNS - 1, COLUMN_INDEX_BYTE_SIZE)]);
  }

  getMinKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(0, COLUMN_INDEX_BYTE_SIZE)]);
  }
}
