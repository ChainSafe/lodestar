import {Db, encodeKey} from "@lodestar/db";
import {Slot, Root, ssz, SSZTypesFor} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {ForkAll} from "@lodestar/params";
import {FullOrBlindedSignedBeaconBlock} from "../../util/fullOrBlindedBlock.js";
import {Bucket} from "../buckets.js";

export async function storeRootIndex(db: Db, slot: Slot, blockRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(blockRoot), intToBytes(slot, 8, "be"));
}

export async function storeParentRootIndex(db: Db, slot: Slot, parentRoot: Root): Promise<void> {
  return db.put(getParentRootIndexKey(parentRoot), intToBytes(slot, 8, "be"));
}

export async function deleteRootIndex(
  db: Db,
  signedBeaconBlockType: SSZTypesFor<ForkAll, "SignedBeaconBlock">,
  block: FullOrBlindedSignedBeaconBlock
): Promise<void> {
  const beaconBlockType = (signedBeaconBlockType as typeof ssz.phase0.SignedBeaconBlock).fields["message"];
  return db.delete(getRootIndexKey(beaconBlockType.hashTreeRoot(block.message)));
}

export async function deleteParentRootIndex(db: Db, block: FullOrBlindedSignedBeaconBlock): Promise<void> {
  return db.delete(getParentRootIndexKey(block.message.parentRoot));
}

export function getParentRootIndexKey(parentRoot: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveParentRootIndex, parentRoot);
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_blockArchiveRootIndex, root);
}
