import {describe, expect, it} from "vitest";
import {SecretKey} from "@lodestar/native/blst";
import {parseRemoteSignerSignature} from "../../../../src/cmds/validator/voluntaryExit.js";

describe("voluntaryExit / parseRemoteSignerSignature", () => {
  const signature = SecretKey.fromKeygen(new Uint8Array(32).fill(1)).sign(new Uint8Array(32).fill(2));

  it("accepts compressed signatures", () => {
    expect(parseRemoteSignerSignature(signature.toHex(true)).toBytes()).toEqual(signature.toBytes());
  });

  it("rejects uncompressed signatures", () => {
    expect(() => parseRemoteSignerSignature(signature.toHex(false))).toThrow("Invalid signature length 192");
  });

  it("rejects signatures with too few bytes", () => {
    expect(() => parseRemoteSignerSignature("0x1234")).toThrow("Invalid signature length 2");
  });
});
