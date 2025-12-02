import {Db, encodeKey} from "@lodestar/db";
import {ForkAll} from "@lodestar/params";
import {Root, SSZTypesFor, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export const rootIndexBucketId = getBucketNameByValue(Bucket.index_blockArchiveRootIndex);
export const parentRootIndexBucketId = getBucketNameByValue(Bucket.index_blockArchiveParentRootIndex);

export async function getRootIndex(db: Db, blockRoot: Root): Promise<Uint8Array | null> {
  return db.get(getRootIndexKey(blockRoot), {bucketId: rootIndexBucketId});
}

export async function getParentRootIndex(db: Db, parentRoot: Root): Promise<Uint8Array | null> {
  return db.get(getParentRootIndexKey(parentRoot), {bucketId: parentRootIndexBucketId});
}

export async function storeRootIndex(db: Db, slot: Slot, blockRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"), {bucketId: rootIndexBucketId});
}

export async function storeParentRootIndex(db: Db, slot: Slot, parentRoot: Root): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"), {bucketId: parentRootIndexBucketId});
}

export async function deleteRootIndex(
  db: Db,
  signedBeaconBlockType: SSZTypesFor<ForkAll, "SignedBeaconBlock">,
  block: SignedBeaconBlock
): Promise<void> {
  const beaconBlockType = (signedBeaconBlockType as typeof ssz.phase0.SignedBeaconBlock).fields.message;
  return db.delete(getRootIndexKey(beaconBlockType.hashTreeRoot(block.message)), {bucketId: rootIndexBucketId});
}

export async function deleteParentRootIndex(db: Db, block: SignedBeaconBlock): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot), {bucketId: parentRootIndexBucketId});
}

export function getParentRootIndexKey(parentRoot: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot);
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root);
}
