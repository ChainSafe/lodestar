import {bytes} from "@chainsafe/eth2.0-types";
// @ts-ignore
import sha256 from "@chainsafe/as-sha256";

export function hash(data: bytes): bytes {
  return Buffer.from(sha256(data));
}