/**
 * @module util/crypto
 */

import {bytes, Hash} from "@chainsafe/eth2.0-types";
import {hash as hash256} from "@chainsafe/ssz";

export function hash(value: bytes): Hash{
  return hash256(value);
}
