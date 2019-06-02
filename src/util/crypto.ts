/**
 * @module util/crypto
 */

import {bytes, bytes32,} from "../types";
import {hash as hash256} from "@chainsafe/ssz/lib/util/hash";

export function hash(value: bytes): bytes32 {
  return hash256(value);
}
