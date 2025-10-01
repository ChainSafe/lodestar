import {describe, expect, it} from "vitest";
import {
  decodeNumberForDbKey,
  decodeStringForDbKey,
  encodeNumberForDbKey,
  encodeStringForDbKey,
} from "../../src/index.js";

describe("encode/decode number for DB key", () => {
  it("roundtrips with fixed byte size (2 bytes)", () => {
    const value = 0xffee;
    const size = 2;

    const encoded = encodeNumberForDbKey(value, size);
    expect(encoded).toEqual(Buffer.from([0xff, 0xee]));

    const decoded = decodeNumberForDbKey(encoded, size);
    expect(decoded).toBe(value);
  });

  it("roundtrips with fixed byte size (4 bytes)", () => {
    const value = 0xdeadbeef >>> 0;
    const size = 4;

    const encoded = encodeNumberForDbKey(value, size);
    expect(encoded).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));

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
