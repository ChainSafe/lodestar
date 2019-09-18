import {Hash} from "@chainsafe/eth2.0-types";
import {intDiv} from "../math";
import {hash} from "../crypto";

/**
 * Verify that the given ``leaf`` is on the merkle branch ``proof``
 * starting with the given ``root``.
 */
export function verifyMerkleBranch(
  leaf: Hash,
  proof: Hash[],
  depth: number,
  index: number,
  root: Hash,
): boolean {
  let value = Buffer.from(leaf);
  for (let i = 0; i < depth; i++) {
    if (intDiv(index, 2**i) % 2) {
      value = hash(Buffer.concat([proof[i], value]));
    } else {
      value = hash(Buffer.concat([value, proof[i]]));
    }
  }
  return value.equals(root);
}
