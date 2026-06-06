import {describe, expect, it} from "vitest";
import {msgIdToStrFn} from "../../../../src/network/gossip/encoding.js";

describe("network / gossip / encoding / msgIdToStrFn", () => {
  it("converts a valid 20-byte msgId to a 0x-prefixed hex string", () => {
    const msgId = new Uint8Array(20).fill(0x11);
    expect(msgIdToStrFn(msgId)).toBe(`0x${"11".repeat(20)}`);
  });

  it("throws on an overlong (>20-byte) msgId instead of a RangeError", () => {
    const msgId = new Uint8Array(21).fill(0x11);
    expect(() => msgIdToStrFn(msgId)).toThrow("Expect msgId to be 20 bytes, got 21");
  });

  it("throws on short msgIds and does not alias stale bytes from a previous conversion", () => {
    // Seed the shared buffer with a full 20-byte ID, as a remote peer would.
    const fullId = new Uint8Array(20).fill(0xaa);
    expect(msgIdToStrFn(fullId)).toBe(`0x${"aa".repeat(20)}`);

    // Short / empty IDs must reject rather than return the previous full ID.
    expect(() => msgIdToStrFn(new Uint8Array(1).fill(0x11))).toThrow("Expect msgId to be 20 bytes, got 1");
    expect(() => msgIdToStrFn(new Uint8Array(0))).toThrow("Expect msgId to be 20 bytes, got 0");
  });
});
