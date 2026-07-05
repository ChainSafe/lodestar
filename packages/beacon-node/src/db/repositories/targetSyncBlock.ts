import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository} from "@lodestar/db";
import {Root, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {getSignedBlockTypeFromBytes} from "../../util/multifork.js";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const ROOT_SIZE = 32;
const SLOT_SIZE = 8;
/** id = beUint64(slot) ++ blockRoot — big-endian so lexicographic key order is slot-ascending. */
const ID_SIZE = SLOT_SIZE + ROOT_SIZE;
const KEY_SIZE = ROOT_SIZE + ID_SIZE;

/** Keys deleted per batch during the boot truncation (bounds memory on huge leaked buckets). */
const TRUNCATE_CHUNK = 10_000;

/**
 * TargetSync per-target block spill store, keyed by `targetRoot ++ beUint64(slot) ++ blockRoot`.
 *
 * The slot in the key is load-bearing: import drains a target's blocks in ascending slot order by
 * range iteration, and per-segment cleanup deletes by slot range, so the full header chain never
 * has to be pinned in memory as an ordering index.
 *
 * Isolated and SCRATCH: rows are meaningless across restarts (fork choice is rebuilt from the
 * anchor every boot), so the bucket is unconditionally truncated at boot (`truncateAll`) — the only
 * deletion path that survives SIGKILL. It is NOT wired into any production read path (getBlock,
 * pruneHotDb, migrations) — backward-walk blocks are unvalidated until imported. Blocks are
 * serialized fork-aware.
 */
export class TargetSyncBlockRepository extends PrefixedRepository<Root, Uint8Array, SignedBeaconBlock> {
  private readonly ownBucketId: string;

  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.gloasTargetSyncBlock;
    const type = ssz.phase0.SignedBeaconBlock; // dummy; serialization is selected per-fork below
    super(config, db, bucket, type, getBucketNameByValue(bucket));
    this.ownBucketId = getBucketNameByValue(bucket);
  }

  /** Encode the 40-byte id for a (slot, blockRoot) pair. */
  encodeId(slot: Slot, blockRoot: Uint8Array): Uint8Array {
    return Buffer.concat([intToBytes(slot, SLOT_SIZE, "be"), blockRoot]);
  }

  /** Id is beUint64(slot) ++ blockRoot (hashTreeRoot of the unsigned BeaconBlock). */
  getId(value: SignedBeaconBlock): Uint8Array {
    const slot = value.message.slot;
    const blockRoot = this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(value.message);
    return this.encodeId(slot, blockRoot);
  }

  encodeValue(value: SignedBeaconBlock): Uint8Array {
    return this.config.getForkTypes(value.message.slot).SignedBeaconBlock.serialize(value);
  }

  decodeValue(data: Uint8Array): SignedBeaconBlock {
    return getSignedBlockTypeFromBytes(this.config, data).deserialize(data);
  }

  encodeKeyRaw(prefix: Root, id: Uint8Array): Uint8Array {
    return Buffer.concat([prefix, id]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: Root; id: Uint8Array} {
    return {
      prefix: raw.slice(0, ROOT_SIZE),
      id: raw.slice(ROOT_SIZE, KEY_SIZE),
    };
  }

  getMaxKeyRaw(prefix: Root): Uint8Array {
    return Buffer.concat([prefix, new Uint8Array(ID_SIZE).fill(0xff)]);
  }

  getMinKeyRaw(prefix: Root): Uint8Array {
    return Buffer.concat([prefix, new Uint8Array(ID_SIZE)]);
  }

  /** `put` that also reports the stored byte size (single serialization). */
  async putSized(prefix: Root, value: SignedBeaconBlock): Promise<number> {
    const bytes = this.encodeValue(value);
    await this.putBinary(prefix, this.getId(value), bytes);
    return bytes.length;
  }

  /**
   * Unconditionally delete every row in the bucket, in bounded chunks.
   * Returns the number of rows deleted. THE crash-recovery path: runs on every
   * boot regardless of engine construction [A1].
   */
  async truncateAll(): Promise<number> {
    const gte = this.wrapKey(new Uint8Array(0));
    // All keys are exactly KEY_SIZE bytes, so 0xff × KEY_SIZE is an inclusive in-bucket upper bound.
    const lte = this.wrapKey(new Uint8Array(KEY_SIZE).fill(0xff));

    let deleted = 0;
    let chunk: Uint8Array[] = [];
    for await (const key of this.db.keysStream({gte, lte, bucketId: this.ownBucketId})) {
      chunk.push(key);
      if (chunk.length >= TRUNCATE_CHUNK) {
        await this.db.batchDelete(chunk, {bucketId: this.ownBucketId});
        deleted += chunk.length;
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      await this.db.batchDelete(chunk, {bucketId: this.ownBucketId});
      deleted += chunk.length;
    }
    return deleted;
  }
}
