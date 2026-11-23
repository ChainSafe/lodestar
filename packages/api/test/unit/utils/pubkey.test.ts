import {describe, expect, it} from "vitest";
import {ApiPubkey} from "../../../src/utils/pubkey.js";

describe("ApiPubkey", () => {
  it("writes a leanXMSS public key as its 32 bytes and reads either form", () => {
    const xmss = new Uint8Array(48);
    xmss.fill(7, 16);
    const json = `0x${"07".repeat(32)}`;
    expect(ApiPubkey.toJson(xmss)).toBe(json);
    expect(ApiPubkey.fromJson(json)).toEqual(xmss);
    expect(ApiPubkey.fromJson(`0x${"00".repeat(16)}${"07".repeat(32)}`)).toEqual(xmss);
  });

  it("leaves a BLS public key as it is", () => {
    const bls = new Uint8Array(48).fill(0xa1);
    const json = `0x${"a1".repeat(48)}`;
    expect(ApiPubkey.toJson(bls)).toBe(json);
    expect(ApiPubkey.fromJson(json)).toEqual(bls);
  });
});
