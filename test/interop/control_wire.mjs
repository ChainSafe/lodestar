import assert from "node:assert/strict";

export const status1 = "/eth2/beacon_chain/req/status/1/ssz_snappy";
export const status2 = "/eth2/beacon_chain/req/status/2/ssz_snappy";
export const metadata1 = "/eth2/beacon_chain/req/metadata/1/ssz_snappy";
export const metadata2 = "/eth2/beacon_chain/req/metadata/2/ssz_snappy";
export const metadata3 = "/eth2/beacon_chain/req/metadata/3/ssz_snappy";
export const ping = "/eth2/beacon_chain/req/ping/1/ssz_snappy";
export const goodbye = "/eth2/beacon_chain/req/goodbye/1/ssz_snappy";
export const controlProtocols = [status1, status2, metadata1, metadata2, metadata3, ping, goodbye];
export const sequence = 0x0807060504030201n;

export function uint64(value) {
  assert(typeof value === "bigint" && value >= 0n && value <= 0xffffffffffffffffn);
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}
export function status(version) {
  assert(version === 1 || version === 2);
  const bytes = Buffer.alloc(version === 1 ? 84 : 92);
  bytes.set([1, 2, 3, 4]);
  for (let i = 0; i < 32; i++) {
    bytes[4 + i] = i;
    bytes[44 + i] = 255 - i;
  }
  bytes.writeBigUInt64LE(0x01020304n, 36);
  bytes.writeBigUInt64LE(0x08070605n, 76);
  if (version === 2) bytes.writeBigUInt64LE(0x090a0b0cn, 84);
  return bytes;
}
export function metadata(version, seq = sequence) {
  assert(version >= 1 && version <= 3);
  const bytes = Buffer.alloc(version === 1 ? 16 : version === 2 ? 17 : 25);
  bytes.set(uint64(seq));
  bytes.set([0x81, 1, 0, 0x80, 0, 0, 0, 0x80], 8);
  if (version >= 2) bytes[16] = 13;
  if (version === 3) bytes.writeBigUInt64LE(4n, 17);
  return bytes;
}
export function response(protocol, seq = sequence) {
  if (protocol === status1) return status(1);
  if (protocol === status2) return status(2);
  if (protocol === metadata1) return metadata(1, seq);
  if (protocol === metadata2) return metadata(2, seq);
  if (protocol === metadata3) return metadata(3, seq);
  if (protocol === ping) return uint64(seq);
  if (protocol === goodbye) return uint64(1n);
  throw Error("unknown control protocol");
}
