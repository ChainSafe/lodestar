import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import crc32c from "@chainsafe/fast-crc32c";
import {compressSync, uncompressSync} from "snappy";

export const MAX = 10 * 1024 * 1024;
export const WIRE_MAX = 32 + MAX + Math.floor(MAX / 6);
export const RPC_MAX = WIRE_MAX + 1024;
export const TOPIC = "/eth2/01000000/beacon_block/ssz_snappy";
export const PING = "/eth2/beacon_chain/req/ping/1/ssz_snappy";
export const BLOCKS = "/eth2/beacon_chain/req/beacon_blocks_by_range/2/ssz_snappy";
const identifier = Buffer.from("ff060000734e61507059", "hex");

export function payload(length, seed = 0x6d2b79f5) {
  assert(Number.isInteger(length) && length >= 0 && length <= MAX);
  const bytes = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    bytes[i] = x & 255;
  }
  return bytes;
}
export function summary(bytes) {
  return {length: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")};
}
export function messageId(topic, bytes, valid = true, phase0 = false) {
  const name = Buffer.from(topic);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(name.length));
  const hash = createHash("sha256").update(Buffer.from([valid ? 1 : 0, 0, 0, 0]));
  if (!phase0) hash.update(length).update(name);
  return hash.update(bytes).digest().subarray(0, 20);
}
export function prefix(value) {
  assert(Number.isSafeInteger(value) && value >= 0);
  const bytes = [];
  let remaining = value;
  for (let i = 0; i < 10; i++) {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(byte | (remaining > 0 ? 128 : 0));
    if (remaining === 0) return Buffer.from(bytes);
  }
  throw Error("varint bound");
}
function masked(bytes) {
  const crc = crc32c.calculate(bytes);
  return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
}
export function encodePayload(bytes, compressed = true) {
  assert(bytes.length <= MAX);
  if (bytes.length === 0) return Buffer.from([0]);
  const parts = [prefix(bytes.length), identifier];
  for (let at = 0; at < bytes.length; at += 65536) {
    const raw = bytes.subarray(at, Math.min(at + 65536, bytes.length));
    const block = compressed ? compressSync(raw) : raw;
    const header = Buffer.alloc(8);
    header[0] = compressed ? 0 : 1;
    header.writeUIntLE(4 + block.length, 1, 3);
    header.writeUInt32LE(masked(raw), 4);
    parts.push(header, block);
  }
  const wire = Buffer.concat(parts);
  assert(wire.length <= WIRE_MAX + 10);
  return wire;
}
class Reader {
  constructor(source) {
    this.iterator = source[Symbol.asyncIterator]();
    this.part = Buffer.alloc(0);
    this.calls = 0;
    this.total = 0;
  }
  async read(length) {
    assert(length >= 0 && length <= MAX);
    const output = Buffer.alloc(length);
    let offset = 0;
    for (let steps = 0; steps < 32768 && offset < length; steps++) {
      if (this.part.length === 0) {
        assert(++this.calls <= 32768, "fragment bound");
        const next = await this.iterator.next();
        assert(!next.done, "truncated response");
        this.part = next.value.subarray();
        this.total += this.part.length;
        assert(this.total <= WIRE_MAX + 32, "wire bound");
      }
      const take = Math.min(length - offset, this.part.length);
      output.set(this.part.subarray(0, take), offset);
      this.part = this.part.subarray(take);
      offset += take;
    }
    assert.equal(offset, length);
    return output;
  }
}
export async function readPayload(source, response = false, context = false) {
  const reader = new Reader(source);
  const result = response ? (await reader.read(1))[0] : 0;
  const digest = context && result === 0 ? (await reader.read(4)).toString("hex") : null;
  let declared = 0n;
  let complete = false;
  for (let i = 0; i < 10; i++) {
    const byte = (await reader.read(1))[0];
    if (i === 9) assert(byte <= 1, "varint overflow");
    declared |= BigInt(byte & 127) << BigInt(7 * i);
    if (!(byte & 128)) {
      complete = true;
      break;
    }
  }
  assert(complete && declared <= BigInt(result === 0 ? MAX : 256), "payload bound");
  const bytes = Buffer.alloc(Number(declared));
  if (bytes.length > 0) assert.deepEqual(await reader.read(10), identifier);
  let written = 0;
  for (let frames = 0; frames < 1024 && written < bytes.length; frames++) {
    const header = await reader.read(8);
    const size = header.readUIntLE(1, 3);
    assert(size >= 4 && size <= 4 + 32 + 65536 + Math.floor(65536 / 6));
    const block = await reader.read(size - 4);
    assert(header[0] === 0 || header[0] === 1);
    const raw = header[0] === 0 ? uncompressSync(block) : block;
    assert(raw.length > 0 && raw.length <= 65536 && written + raw.length <= bytes.length);
    assert.equal(masked(raw), header.readUInt32LE(4), "checksum mismatch");
    bytes.set(raw, written);
    written += raw.length;
  }
  assert.equal(written, bytes.length);
  assert.equal(reader.part.length, 0, "trailing bytes in chunk");
  return {bytes, context: digest, result};
}
export async function sendFragments(stream, bytes, signal) {
  assert(bytes.length <= RPC_MAX + 10);
  let offset = 0;
  let x = 0x9e3779b9;
  for (let writes = 0; writes < 4096 && offset < bytes.length; writes++) {
    signal.throwIfAborted();
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    const end = Math.min(offset + 1 + (x % 16384), bytes.length);
    if (!stream.send(bytes.subarray(offset, end))) await stream.onDrain({signal});
    offset = end;
  }
  assert.equal(offset, bytes.length);
}
export function loopback(value) {
  assert(/^\/ip4\/127\.0\.0\.1\/udp\/[1-9][0-9]{0,4}\/quic-v1\/p2p\/[A-Za-z0-9]+$/.test(value));
  assert(Number(value.split("/")[4]) <= 65535);
  return value;
}

export function rangeRequest() {
  const bytes = Buffer.alloc(24);
  const startSlot = 0n;
  const count = 1n;
  const step = 1n;
  bytes.writeBigUInt64LE(startSlot, 0);
  bytes.writeBigUInt64LE(count, 8);
  bytes.writeBigUInt64LE(step, 16);
  return bytes;
}
