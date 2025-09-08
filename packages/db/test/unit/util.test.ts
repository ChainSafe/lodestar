import {intToBytes} from "@lodestar/utils";
import {describe, it, expect} from "vitest";
import {
  encodeNumberForDbKey,
  decodeNumberForDbKey,
  encodeStringForDbKey,
  decodeStringForDbKey,
} from "../../src/index.js";

describe("encode/decode number for DB key", () => {
  it("roundtrips with fixed byte size (2 bytes)", () => {
    const value = 0xffff; // 65535
    const size = 2;
    const encoded = encodeNumberForDbKey(value, size);
    expect(encoded).toEqual(intToBytes(value, size, "be"));
    const decoded = decodeNumberForDbKey(encoded, size);
    expect(decoded).toBe(value);
  });

  it("roundtrips with fixed byte size (4 bytes)", () => {
    const value = 0xdeadbeef >>> 0; // 3735928559
    const size = 4;
    const encoded = encodeNumberForDbKey(value, size);
    expect(encoded).toEqual(intToBytes(value, size, "be"));
    const decoded = decodeNumberForDbKey(encoded, size);
    expect(decoded).toBe(value);
  });

  it("decodes only the first N bytes (ignores trailing)", () => {
    const size = 2;
    const base = encodeNumberForDbKey(1, size);
    const withTrailing = Buffer.concat([base, Buffer.from([0x99, 0x99])]);
    const decoded = decodeNumberForDbKey(withTrailing, size);
    expect(decoded).toBe(1);
  });
});

describe("encode/decode string for DB key", () => {
  it("encodes UTF-8 string", () => {
    const value = "hello";
    const encoded = encodeStringForDbKey(value);
    expect(encoded).toEqual(Buffer.from(value, "utf-8"));
  });

  it("roundtrips Unicode strings", () => {
    const value = "héłłø 🌟";
    const encoded = encodeStringForDbKey(value);
    const decoded = decodeStringForDbKey(encoded);
    expect(decoded).toBe(value);
  });
});
