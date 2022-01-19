import SHA256 from "@chainsafe/as-sha256";

export function hash(...inputs: Uint8Array[]): Uint8Array {
  return SHA256.digest(Buffer.concat(inputs));
}

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
    if (Math.floor(index / 2 ** i) % 2) {
      value = SHA256.digest64(Buffer.concat([proof[i], value]));
    } else {
      value = SHA256.digest64(Buffer.concat([value, proof[i]]));
    }
  }
  return Buffer.from(value).equals(root);
}
