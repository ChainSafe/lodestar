import {ChainForkConfig} from "@lodestar/config";
import {Db, PrefixedRepository} from "@lodestar/db";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {BlobIndex, Slot, deneb, ssz} from "@lodestar/types";
import {bytesToInt, intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * BlobSidecarsArchiveRepository
 * Used to store `finalized` BlobsSidecars
 *
 * Indexed data by `slot` || `blobIndex`
 */
export class BlobSidecarArchiveRepository extends PrefixedRepository<Slot, BlobIndex, deneb.BlobSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.allForks_blobSidecars;
    super(config, db, bucket, ssz.deneb.BlobSidecar, getBucketNameByValue(bucket));
  }

  getId(value: deneb.BlobSidecar) {
    return value.index;
  }

  encodeKeyRaw(prefix: Slot, id: BlobIndex): Uint8Array {
    return Buffer.concat([intToBytes(prefix, 4), intToBytes(id, 4)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: Slot; id: BlobIndex} {
    return {
      prefix: bytesToInt(raw.slice(0, 4)),
      id: bytesToInt(raw.slice(4, 8)) as BlobIndex,
    };
  }

  getMaxKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([
      intToBytes(prefix, 4),
      intToBytes(this.config.getMaxBlobsPerBlock(computeEpochAtSlot(prefix)), 4),
    ]);
  }

  getMinKeyRaw(prefix: Slot): Uint8Array {
    return Buffer.concat([intToBytes(prefix, 4), intToBytes(0, 4)]);
  }
}
