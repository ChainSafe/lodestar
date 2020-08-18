import {intDiv} from "./math";
import {hash} from "@chainsafe/ssz";

/**
 * Verify that the given ``leaf`` is on the merkle branch ``proof``
 * starting with the given ``root``.
 */
export function verifyMerkleBranch(
  leaf: Uint8Array,
  proof: Uint8Array[],
  depth: number,
  index: number,
  root: Uint8Array
): boolean {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (intDiv(index, 2 ** i) % 2) {
      value = hash(Buffer.concat([proof[i], value]));
    } else {
      value = hash(Buffer.concat([value, proof[i]]));
    }
  }
  return Buffer.from(value).equals(root);
}
