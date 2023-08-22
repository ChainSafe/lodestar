import {Db, encodeKey} from "@lodestar/db";
import {Slot, Root, allForks} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {Bucket} from "../buckets.js";

export async function storeRootIndex(db: Db, slot: Slot, blockRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"));
}

export async function storeParentRootIndex(db: Db, slot: Slot, parentRoot: Root): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"));
}

export async function deleteRootIndex(
  db: Db,
  beaconBlockType: allForks.AllForksSSZTypes["BeaconBlock"],
  block: allForks.FullOrBlindedSignedBeaconBlock
): Promise<void> {
  return db.delete(getRootIndexKey(beaconBlockType.hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex(db: Db, block: allForks.FullOrBlindedSignedBeaconBlock): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot);
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root);
}
