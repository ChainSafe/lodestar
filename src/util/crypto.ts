/**
 * @module util/crypto
 */

import {bytes, bytes32,} from "../types";
import {sha256} from "js-sha256";

export function hash(value: bytes): bytes32 {
  return Buffer.from(sha256.arrayBuffer(value));
}
