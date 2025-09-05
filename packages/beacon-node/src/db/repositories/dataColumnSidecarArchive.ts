import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, Slot, fulu, ssz} from "@lodestar/types";
import {bytesToInt, intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

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
    return Buffer.concat([intToBytes(prefix, 4, "be"), intToBytes(id, 4, "be")]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: Slot; id: ColumnIndex} {
    return {
      prefix: bytesToInt(raw.slice(0, 4), "be") as Slot,
      id: bytesToInt(raw.slice(4, 8), "be") as ColumnIndex,
    };
  }

  getMaxKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([intToBytes(prefix, 4, "be"), intToBytes(NUMBER_OF_COLUMNS, 4, "be")]);
  }

  getMinKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([intToBytes(prefix, 4, "be"), intToBytes(0, 4, "be")]);
  }
}
