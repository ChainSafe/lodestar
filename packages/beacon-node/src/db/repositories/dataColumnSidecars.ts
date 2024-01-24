import {ValueOf, ContainerType, ByteVectorType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";

import {Bucket, getBucketNameByValue} from "../buckets.js";

export const dataColumnSidecarsWrapperSsz = new ContainerType(
  {
    blockRoot: ssz.Root,
    slot: ssz.Slot,
    dataColumnsLen: ssz.Uint16,
    dataColumnsSize: ssz.UintNum64,
    // // each byte[i] tells what index (1 based) the column i is stored, 0 means not custodied
    // max value to represent will be 128 which can be represented in a byte
    dataColumnsIndex: new ByteVectorType(NUMBER_OF_COLUMNS),
    dataColumnSidecars: ssz.electra.DataColumnSidecars,
  },
  {typeName: "DataColumnSidecarsWrapper", jsonCase: "eth2"}
);

export type DataColumnSidecarsWrapper = ValueOf<typeof dataColumnSidecarsWrapperSsz>;
export const BLOCK_ROOT_IN_WRAPPER_INDEX = 0;
export const BLOCK_SLOT_IN_WRAPPER_INDEX = 32;
export const NUM_COLUMNS_IN_WRAPPER_INDEX = 40;
export const COLUMN_SIZE_IN_WRAPPER_INDEX = 42;
export const CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX = 50;
export const DATA_COLUMN_SIDECARS_IN_WRAPPER_INDEX =
  CUSTODY_COLUMNS_IN_IN_WRAPPER_INDEX + NUMBER_OF_COLUMNS + 4 + 4 * NUMBER_OF_COLUMNS;

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
