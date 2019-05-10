/**
 * @module util/crypto
 */

import {keccakAsU8a} from "@polkadot/util-crypto";

import {
  bytes,
  bytes32,
} from "../types";


// This function was copied from ssz-js
// TODO: either export hash from ssz-js or move to a util-crypto library
export function hash(value: bytes): bytes32 {
  return Buffer.from(keccakAsU8a(value));
}
