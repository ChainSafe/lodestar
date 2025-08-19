import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Root, fulu, ssz} from "@lodestar/types";
import {bytesToInt, intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

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
    return Buffer.concat([prefix, intToBytes(id, 4)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: BlockRoot; id: ColumnIndex} {
    return {
      prefix: raw.slice(0, 32) as BlockRoot,
      id: bytesToInt(raw.slice(32, 36)) as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, intToBytes(NUMBER_OF_COLUMNS, 4)]);
  }

  getMinKeyRaw(prefix: BlockRoot): Uint8Array {
    return Buffer.concat([prefix, intToBytes(0, 4)]);
  }
}
