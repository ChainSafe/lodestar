import {ChainForkConfig} from "@lodestar/config";
import {Db, KeyValue, Repository} from "@lodestar/db";
import {allForks, ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";
import {IExecutionEngine} from "../../execution/index.js";
import {DatabaseOptions} from "../options.js";
import {
  calculateRoots,
  fullToBlindedSignedBeaconBlock,
  isFullBlock,
  isSerializedBlinded,
} from "./blockBlindingAndUnblinding.js";

export interface BlockPutBinaryItem extends KeyValue<Uint8Array, Uint8Array> {
  forkSeq: ForkSeq;
  transactionRoot: Uint8Array;
  withdrawalsRoot: Uint8Array;
}

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class BlockRepository extends Repository<Uint8Array, allForks.FullOrBlindedSignedBeaconBlock> {
  saveBlinded: boolean;

  private executionEngine?: IExecutionEngine;

  constructor(config: ChainForkConfig, opts: DatabaseOptions, db: Db) {
    const bucket = Bucket.allForks_block;
    const type = ssz.phase0.SignedBeaconBlock; // Pick some type but won't be used
    super(config, db, bucket, type, getBucketNameByValue(bucket));
    this.saveBlinded = opts.saveBlindedBlocks ?? true;
  }

  setExecutionEngine(engine: IExecutionEngine): void {
    this.executionEngine = engine;
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: allForks.FullOrBlindedSignedBeaconBlock): Uint8Array {
    return isFullBlock(value)
      ? this.config.getForkTypes(value.message.slot).BeaconBlock.hashTreeRoot(value.message)
      : this.config
          .getBlindedForkTypes(value.message.slot)
          .BeaconBlock.hashTreeRoot((value as allForks.SignedBlindedBeaconBlock).message);
  }

  encodeValue(value: allForks.FullOrBlindedSignedBeaconBlock): Uint8Array {
    if (isFullBlock(value)) {
      const forkSeq = this.config.getForkSeq(value.message.slot);
      const {transactionRoot, withdrawalsRoot} = calculateRoots(forkSeq, value);
      return fullToBlindedSignedBeaconBlock(
        forkSeq,
        this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value),
        transactionRoot,
        withdrawalsRoot
      );
    }
    return this.config
      .getBlindedForkTypes(value.message.slot)
      .SignedBeaconBlock.serialize(value as allForks.SignedBlindedBeaconBlock);
  }

  decodeValue(data: Buffer): allForks.FullOrBlindedSignedBeaconBlock {
    return getSignedBlockTypeFromBytes(this.config, data, isSerializedBlinded(data)).deserialize(data);
  }

  /**
   * Get blocks provides two APIs to retrieve data. The repository contains both
   * blinded and full, non-blinded, blocks. In general it is faster to just `get`
   * the block as it was originally stored. For calls that must operate on the
   * full block use the `*Full*` methods.
   */
  async get(root: Uint8Array): Promise<allForks.FullOrBlindedSignedBeaconBlock | null> {
    root;
    return null;
  }

  async getFull(root: Uint8Array): Promise<allForks.SignedBeaconBlock | null> {
    root;
    return null;
  }

  async getFullBinary(root: Uint8Array): Promise<Uint8Array | null> {
    root;
    return null;
  }

  /**
   * All blocks are stored blinded. Only `putBinary` does not `encodeValue`
   * before storage
   */
  async putBinary(root: Uint8Array, value: Uint8Array): Promise<void> {
    root;
    value;
  }

  async putFullBinary(block: BlockPutBinaryItem): Promise<void> {
    block;
  }

  async batchPutBinary(blocks: BlockPutBinaryItem[]): Promise<void> {
    blocks;
  }
}
