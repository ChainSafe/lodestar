import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository} from "@lodestar/db";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {BlobIndex, Root, Slot, deneb, ssz} from "@lodestar/types";
import {bytesToInt, intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

type BlockRoot = Root;
// Because the maximum number of blobs is dependent on epoch/fork
// So we need to know the `slot` to calculate min/max key
type PrefixedData = {blockRoot: BlockRoot; slot: Slot};

const minBlockRoot = Uint8Array.from(Array.from({length: 32}, () => 0));
const maxBlockRoot = Uint8Array.from(Array.from({length: 32}, () => 255));
const minSlot = 0;
const maxSlot = bytesToInt(Uint8Array.from(Array.from({length: 4}, () => 255)));

/**
 * BlobSidecarsRepository
 * Used to store `unfinalized` BlobsSidecars
 *
 * Indexed data by `blockRoot` || slot || `blobIndex`
 */
export class BlobSidecarRepository extends PrefixedRepository<PrefixedData, BlobIndex, deneb.BlobSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blobSidecars;
    super(config, db, bucket, ssz.deneb.BlobSidecar, getBucketNameByValue(bucket));
  }

  getId(value: deneb.BlobSidecar) {
    return value.index;
  }

  encodeKeyRaw(prefix: PrefixedData, id: BlobIndex): Uint8Array {
    return Buffer.concat([prefix.blockRoot, intToBytes(prefix.slot, 4), intToBytes(id, 4)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: PrefixedData; id: BlobIndex} {
    return {
      prefix: {blockRoot: raw.slice(0, 32) as BlockRoot, slot: bytesToInt(raw.slice(32, 36))},
      id: bytesToInt(raw.slice(36, 40)) as BlobIndex,
    };
  }

  getMaxKeyRaw(prefix: PrefixedData): Uint8Array {
    return Buffer.concat([
      prefix.blockRoot,
      intToBytes(prefix.slot, 4),
      intToBytes(this.config.getMaxBlobsPerBlock(computeEpochAtSlot(prefix.slot)), 4),
    ]);
  }

  getMinKeyRaw(prefix: PrefixedData): Uint8Array {
    return Buffer.concat([prefix.blockRoot, intToBytes(prefix.slot, 4), intToBytes(0, 4)]);
  }

  async deleteAll(blockRoots?: BlockRoot[]): Promise<void> {
    if (!blockRoots) {
      const maxKey = this.wrapKey(this.getMaxKeyRaw({blockRoot: maxBlockRoot, slot: maxSlot}));
      const minKey = this.wrapKey(this.getMinKeyRaw({blockRoot: minBlockRoot, slot: minSlot}));
      const keys = await this.db.keys({gte: minKey, lte: maxKey, bucketId: this.bucketId});
      return await this.db.batchDelete(keys, this.dbReqOpts);
    }

    const keys = [];
    for (const blockRoot of blockRoots) {
      const maxKey = this.wrapKey(this.getMaxKeyRaw({blockRoot, slot: maxSlot}));
      const minKey = this.wrapKey(this.getMinKeyRaw({blockRoot, slot: minSlot}));
      keys.push(await this.db.keys({gte: minKey, lte: maxKey, bucketId: this.bucketId}));
    }
    await this.db.batchDelete(keys.flat());
  }
}
