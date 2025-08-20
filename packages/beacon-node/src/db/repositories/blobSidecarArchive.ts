import {ChainForkConfig} from "@lodestar/config";
import {BUCKET_LENGTH, Db, PrefixedRepository} from "@lodestar/db";
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

  async migrateFromWrapperState(): Promise<void> {
    const minBlockRoot = Uint8Array.from(Array.from({length: 32}, () => 0));
    const maxBlockRoot = Uint8Array.from(Array.from({length: 32}, () => 255));
    const blobSidecarsInWrapperIndex = 44;
    const slotInWrapperIndex = 33;

    const keys = await this.db.keys({gte: this.wrapKey(minBlockRoot), lte: this.wrapKey(maxBlockRoot)});

    for (const key of keys) {
      const oldBytes = await this.db.get(key, this.dbReqOpts);
      if (!oldBytes) continue;

      // Old db state was indexed with block root
      if (key.length !== 32 + BUCKET_LENGTH) continue;

      const blobSidecars = ssz.deneb.BlobSidecars.deserialize(oldBytes?.slice(blobSidecarsInWrapperIndex));
      const slot = bytesToInt(oldBytes.slice(slotInWrapperIndex, slotInWrapperIndex + 8));

      await this.db.delete(key);
      await this.putMany(slot, blobSidecars);
    }
  }
}
