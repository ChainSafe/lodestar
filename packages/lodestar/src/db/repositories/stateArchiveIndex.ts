import {Bucket, encodeKey, IDatabaseController} from "@chainsafe/lodestar-db";
import {Root, Slot} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";

export function storeRootIndex(db: IDatabaseController<Buffer, Buffer>, slot: Slot, stateRoot: Root): Promise<void> {
  return db.put(getRootIndexKey(stateRoot), intToBytes(slot, 8, "be"));
}

export function getRootIndexKey(root: Root): Buffer {
  return encodeKey(Bucket.index_stateArchiveRootIndex, root.valueOf() as Uint8Array);
}
