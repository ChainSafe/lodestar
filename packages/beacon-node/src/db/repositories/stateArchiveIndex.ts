import {Db, encodeKey} from "@lodestar/db";
import {Root} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

const bucketId = getBucketNameByValue(Bucket.index_stateArchiveRootIndex);

export function getRootIndex(db: Db, stateRoot: Root): Promise<Uint8Array | null> {
  return db.get(getRootIndexKey(stateRoot), {bucketId});
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_stateArchiveRootIndex, root);
}
