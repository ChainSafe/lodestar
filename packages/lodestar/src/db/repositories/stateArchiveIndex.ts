import {Bucket, encodeKey, Db} from "@chainsafe/lodestar-db";
import {Root, Slot} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";

export function storeRootIndex(db: Db, slot: Slot, stateRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(stateRoot), intToBytes(slot, 8, "be"));
}

export function getRootIndexKey(root: Root): Uint8Array {
  return encodeKey(Bucket.index_stateArchiveRootIndex, root.valueOf() as Uint8Array);
}
