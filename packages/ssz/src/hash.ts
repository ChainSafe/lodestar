/** @module ssz */
import SHA256 from "bcrypto/lib/sha256";

const sha256 = new SHA256();

/**
 * Hash used for hashTreeRoot
 */
export function hash(...inputs: Buffer[]): Buffer {
  return inputs.reduce((acc, i) => acc.update(i), sha256.init()).final();
}
