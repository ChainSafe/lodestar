import {byteArrayEquals} from "@lodestar/utils";
import {VersionedHashes} from "./interface.js";

/**
 * Preserve Deneb's is_valid_versioned_hashes check when the REST envelope omits expected hashes.
 * EIP-4844 encodes blob_versioned_hashes at index 10 of the signed type-3 transaction's RLP list.
 * Skip unrelated fields without decoding or copying them, including untrusted nested access lists.
 * The EL remains responsible for the other transaction validity checks.
 */
export function isValidBlobVersionedHashes(transactions: Uint8Array[], expected: VersionedHashes): boolean {
  let index = 0;
  for (const transaction of transactions) {
    if (transaction.length === 0) return false;
    if (transaction[0] !== 0x03) continue;

    const outer = readRlpItem(transaction, 1, transaction.length);
    if (!outer?.isList || outer.end !== transaction.length) return false;

    let offset = outer.start;
    for (let fieldIndex = 0; fieldIndex < 14; fieldIndex++) {
      const field = readRlpItem(transaction, offset, outer.end);
      if (field === null) return false;
      if (fieldIndex === 10) {
        if (!field.isList) return false;
        // A canonical RLP-encoded Bytes32 is exactly the 0xa0 prefix followed by 32 bytes.
        const count = (field.end - field.start) / 33;
        if (!Number.isInteger(count) || index + count > expected.length) return false;
        for (let hashOffset = field.start; hashOffset < field.end; hashOffset += 33) {
          if (
            transaction[hashOffset] !== 0xa0 ||
            !byteArrayEquals(transaction.subarray(hashOffset + 1, hashOffset + 33), expected[index])
          ) {
            return false;
          }
          index++;
        }
      }
      offset = field.end;
    }
    if (offset !== outer.end) return false;
  }
  return index === expected.length;
}

/** Read one RLP item's boundaries without descending into lists. */
function readRlpItem(
  bytes: Uint8Array,
  offset: number,
  limit: number
): {start: number; end: number; isList: boolean} | null {
  if (offset >= limit) return null;
  const prefix = bytes[offset];
  if (prefix < 0x80) return {start: offset, end: offset + 1, isList: false};

  const isList = prefix >= 0xc0;
  const lengthCode = prefix - (isList ? 0xc0 : 0x80);
  let start = offset + 1;
  let length = lengthCode;
  if (lengthCode > 55) {
    const lengthBytes = lengthCode - 55;
    start += lengthBytes;
    if (start > limit || bytes[offset + 1] === 0) return null;
    length = 0;
    for (let i = offset + 1; i < start; i++) {
      length = length * 256 + bytes[i];
    }
    if (length <= 55) return null;
  }
  if (length > limit - start) return null;
  if (!isList && length === 1 && bytes[start] < 0x80) return null;
  return {start, end: start + length, isList};
}
