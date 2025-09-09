import {ChainForkConfig} from "@lodestar/config";
import {Db, decodeNumberForDbKey, encodeNumberForDbKey, PrefixedRepository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Root, fulu, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const columnIndexByteSize = 4;
const blockRootByteSize = 32;

type BlockRoot = Root;

/**
 * DataColumnSidecarsRepository
 * Used to store `unfinalized` DataColumnSidecars
 *
 * Indexed data by `blockRoot` + `columnIndex`
 */
export class DataColumnSidecarRepository extends PrefixedRepository<BlockRoot, ColumnIndex, fulu.DataColumnSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_dataColumnSidecars;
    super(config, db, bucket, ssz.fulu.DataColumnSidecar, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: fulu.DataColumnSidecar): ColumnIndex {
    return value.index;
  }

  encodeKeyRaw(prefix: BlockRoot, id: ColumnIndex): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(id, columnIndexByteSize)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: BlockRoot; id: ColumnIndex} {
    return {
      prefix: raw.slice(0, blockRootByteSize) as BlockRoot,
      id: decodeNumberForDbKey(raw.slice(blockRootByteSize), columnIndexByteSize) as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(NUMBER_OF_COLUMNS, columnIndexByteSize)]);
  }

  getMinKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, encodeNumberForDbKey(0, columnIndexByteSize)]);
  }
}
