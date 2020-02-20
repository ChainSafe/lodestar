// @ts-ignore
import SHA256 from "bcrypto/lib/sha256";

const sha256 = new SHA256();

export function hash(data: Uint8Array): Buffer {
  const h = sha256.init();
  h.update(Buffer.from(data));
  return Buffer.from(h.final());
}
