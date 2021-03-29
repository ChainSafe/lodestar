import {IDatabaseController, encodeKey, Bucket} from "@chainsafe/lodestar-db";
import {Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";

export async function storeRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  slot: Slot,
  blockRoot: Root
): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"));
}

export async function storeParentRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  slot: Slot,
  parentRoot: Root
): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"));
}

export async function deleteRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  blockType: ContainerType<allForks.SignedBeaconBlock>,
  block: allForks.SignedBeaconBlock
): Promise<void> {
  return db.delete(getRootIndexKey(blockType.fields["message"].hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  block: allForks.SignedBeaconBlock
): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Buffer {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot.valueOf() as Uint8Array);
}

export function getRootIndexKey(root: Root): Buffer {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root.valueOf() as Uint8Array);
}
