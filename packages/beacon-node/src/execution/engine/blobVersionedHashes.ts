import {RLP} from "@ethereumjs/rlp";
import {byteArrayEquals} from "@lodestar/utils";
import {VersionedHashes} from "./interface.js";

/**
 * Preserve Deneb's is_valid_versioned_hashes check when the REST envelope omits expected hashes.
 * EIP-4844 encodes blob_versioned_hashes at index 10 of the signed type-3 transaction's RLP list.
 * The EL remains responsible for the other transaction validity checks.
 */
export function isValidBlobVersionedHashes(transactions: Uint8Array[], expected: VersionedHashes): boolean {
  let index = 0;
  for (const transaction of transactions) {
    if (transaction.length === 0) return false;
    if (transaction[0] !== 0x03) continue;

    try {
      const fields = RLP.decode(transaction.subarray(1));
      if (!Array.isArray(fields) || fields.length !== 14) return false;
      const hashes = fields[10];
      if (!Array.isArray(hashes)) return false;
      for (const hash of hashes) {
        if (
          !(hash instanceof Uint8Array) ||
          hash.length !== 32 ||
          index >= expected.length ||
          !byteArrayEquals(hash, expected[index])
        ) {
          return false;
        }
        index++;
      }
    } catch {
      return false;
    }
  }
  return index === expected.length;
}
