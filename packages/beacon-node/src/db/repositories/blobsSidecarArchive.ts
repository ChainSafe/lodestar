import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository, KeyValue, FilterOptions, Bucket} from "@lodestar/db";
import {Slot, Root, ssz, deneb} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";

export interface BlockFilterOptions extends FilterOptions<Slot> {
  step?: number;
}

export type BlockArchiveBatchPutBinaryItem = KeyValue<Slot, Uint8Array> & {
  slot: Slot;
  blockRoot: Root;
  parentRoot: Root;
};

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlobsSidecarArchiveRepository extends Repository<Slot, deneb.BlobsSidecar> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.allForks_blobsSidecarArchive, ssz.deneb.BlobsSidecar);
  }

  // Handle key as slot

  getId(value: deneb.BlobsSidecar): Slot {
    return value.beaconBlockSlot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
