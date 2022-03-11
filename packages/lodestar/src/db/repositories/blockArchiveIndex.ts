import {Db, encodeKey, Bucket} from "@chainsafe/lodestar-db";
import {Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";

export async function storeRootIndex(db: Db, slot: Slot, blockRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"));
}

export async function storeParentRootIndex(db: Db, slot: Slot, parentRoot: Root): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"));
}

export async function deleteRootIndex(
  db: Db,
  blockType: ContainerType<allForks.SignedBeaconBlock>,
  block: allForks.SignedBeaconBlock
): Promise<void> {
  return db.delete(getRootIndexKey(blockType.fields["message"].hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex(db: Db, block: allForks.SignedBeaconBlock): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot.valueOf() as Uint8Array);
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root.valueOf() as Uint8Array);
}
