import {bytes} from "@chainsafe/eth2.0-types";
// @ts-ignore
import SHA256 from "bcrypto/lib/sha256";

const sha256 = new SHA256();

export function hash(data: bytes): bytes {
  const h = sha256.init();
  h.update(data);
  return Buffer.from(h.final());
}
