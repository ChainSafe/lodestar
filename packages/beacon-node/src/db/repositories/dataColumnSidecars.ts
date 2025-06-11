import {ByteVectorType, ContainerType, ValueOf} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ssz} from "@lodestar/types";

import {Bucket, getBucketNameByValue} from "../buckets.js";

export const dataColumnSidecarsWrapperSsz = new ContainerType(
  {
    blockRoot: ssz.Root,
    slot: ssz.Slot,
    dataColumnsLen: ssz.Uint8,
    dataColumnsSize: ssz.UintNum64,
    // // each byte[i] tells what index (1 based) the column i is stored, 0 means not custodied
    // max value to represent will be 128 which can be represented in a byte
    dataColumnsIndex: new ByteVectorType(NUMBER_OF_COLUMNS),
    dataColumnSidecars: ssz.fulu.DataColumnSidecars,
  },
  {typeName: "DataColumnSidecarsWrapper", jsonCase: "eth2"}
);

export type DataColumnSidecarsWrapper = ValueOf<typeof dataColumnSidecarsWrapperSsz>;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_BLOCK_ROOT = 0;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_SLOT = 32;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_NUM_OF_COLUMNS = 40;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_COLUMN_SIZE = 41;
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX = 49;
export const SSZ_OFFSET_BYTES_FOR_LIST_TYPE = 4;
// dataColumnSidecars is a variable length container so there is a byte offset to the beginning
// of the container before the container itself.
export const COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_TO_FIRST_SIDECAR =
  COLUMN_SIDECAR_WRAPPER_BYTE_OFFSET_CUSTODY_INDEX + NUMBER_OF_COLUMNS + SSZ_OFFSET_BYTES_FOR_LIST_TYPE;

/**
 * dataColumnSidecarsWrapper by block root (= hash_tree_root(SignedBeaconBlock.message))
 *
 * Used to store unfinalized DataColumnSidecars
 */
export class DataColumnSidecarsRepository extends Repository<Uint8Array, DataColumnSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_dataColumnSidecars;
    super(config, db, bucket, dataColumnSidecarsWrapperSsz, getBucketNameByValue(bucket));
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: DataColumnSidecarsWrapper): Uint8Array {
    const {blockRoot} = value;
    return blockRoot;
  }
}
