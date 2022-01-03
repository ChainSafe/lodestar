import {ByteVector} from "@chainsafe/ssz";

/**
 * toHexString() creates hex strings via string concatenation, which are very memory inneficient.
 * Memory benchmarks show that Buffer.toString("hex") produces strings with 10x less memory.
 *
 * Does not prefix to save memory, thus the prefix is removed from an already string representation.
 *
 * See https://github.com/ChainSafe/lodestar/issues/3446
 */
export function toHexNoPrefix(bytes: Uint8Array | ByteVector): string {
  return Buffer.from(bytes as Uint8Array).toString("hex");
}
