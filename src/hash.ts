/** @module ssz */
import { sha256 } from "js-sha256";

/**
 * Hash used for hashTreeRoot
 */
export function hash(...inputs: Buffer[]): Buffer {
  return Buffer.from(inputs.reduce((acc, i) => acc.update(i), sha256.create()).arrayBuffer());
}
