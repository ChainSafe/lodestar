import {Db, encodeKey, Bucket} from "@chainsafe/lodestar-db";
import {Slot, Root, allForks, ssz} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";

export async function storeRootIndex(db: Db, slot: Slot, blockRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"));
}

export async function storeParentRootIndex(db: Db, slot: Slot, parentRoot: Root): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"));
}

export async function deleteRootIndex(
  db: Db,
  signedBeaconBlockType: allForks.AllForksSSZTypes["SignedBeaconBlock"],
  block: allForks.SignedBeaconBlock
): Promise<void> {
  const beaconBlockType = (signedBeaconBlockType as typeof ssz.phase0.SignedBeaconBlock).fields["message"];
  return db.delete(getRootIndexKey(beaconBlockType.hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex(db: Db, block: allForks.SignedBeaconBlock): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot);
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root);
}
