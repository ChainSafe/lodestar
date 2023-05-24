import {ChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";

import {blobSidecarsWrapperSsz, BlobSidecarsWrapper} from "./blobSidecars.js";

/**
 * blobSidecarsWrapper by slot
 *
 * Used to store finalized BlobSidecars
 */
export class BlobSidecarsArchiveRepository extends Repository<Slot, BlobSidecarsWrapper> {
  constructor(config: ChainForkConfig, db: Db) {
    super(config, db, Bucket.allForks_blobSidecarsArchive, blobSidecarsWrapperSsz);
  }

  // Handle key as slot

  getId(value: BlobSidecarsWrapper): Slot {
    return value.slot;
  }

  decodeKey(data: Uint8Array): number {
    return bytesToInt(super.decodeKey(data) as unknown as Uint8Array, "be");
  }
}
