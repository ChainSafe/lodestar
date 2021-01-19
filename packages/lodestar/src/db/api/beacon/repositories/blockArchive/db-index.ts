import {IDatabaseController, encodeKey, Bucket} from "@chainsafe/lodestar-db";
import {Slot, Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";

export async function storeRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  slot: Slot,
  blockRoot: Root
): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 64, "be"));
}

export async function storeParentRootIndex(
  db: IDatabaseController<Buffer, Buffer>,
  slot: Slot,
  parentRoot: Root
): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 64, "be"));
}

export async function deleteRootIndex<TBlock extends SignedBeaconBlock>(
  db: IDatabaseController<Buffer, Buffer>,
  blockMessageType: ContainerType<TBlock["message"]>,
  block: TBlock
): Promise<void> {
  return db.delete(getRootIndexKey(blockMessageType.hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex<TBlock extends SignedBeaconBlock>(
  db: IDatabaseController<Buffer, Buffer>,
  block: TBlock
): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Buffer {
  return encodeKey(Bucket.blockArchiveParentRootIndex, parentRoot.valueOf() as Uint8Array);
}

export function getRootIndexKey(root: Root): Buffer {
  return encodeKey(Bucket.blockArchiveRootIndex, root.valueOf() as Uint8Array);
}
