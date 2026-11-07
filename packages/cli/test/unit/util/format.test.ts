import {describe, expect, it} from "vitest";
import {SecretKey} from "@lodestar/native/blst";
import {assertValidPubkeysHex, isValidatePubkeyHex, parseRange} from "../../../src/util/index.js";

describe("util / format / parseRange", () => {
  const testCases: {range: string; res: number[]}[] = [
    {range: "0..0", res: [0]},
    {range: "0..1", res: [0, 1]},
    {range: "4..8", res: [4, 5, 6, 7, 8]},
  ];

  for (const {range, res} of testCases) {
    it(range, () => {
      expect(parseRange(range)).toEqual(res);
    });
  }
});

describe("util / format / isValidatePubkeyHex", () => {
  const testCases: Record<string, boolean> = {
    "../../malicious_link/0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95": false,
    "0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95": true,
    "0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c9": false,
    "0x933ad9491b62059dd065b560d256d8957a8c402cc6e8d8ee7290ae11e8f7329267a8811c397529dac52ae1342ba58c95f": false,
    "0xaaaaaaaaaaaaaaaaaa": false,
  };

  for (const [pubkeyHex, isValid] of Object.entries(testCases)) {
    it(pubkeyHex, () => {
      expect(isValidatePubkeyHex(pubkeyHex)).toBe(isValid);
    });
  }
});

describe("util / format / assertValidPubkeysHex", () => {
  const publicKey = SecretKey.fromKeygen(new Uint8Array(32).fill(1)).toPublicKey();

  it("accepts compressed public keys", () => {
    expect(() => assertValidPubkeysHex([publicKey.toHex(true)])).not.toThrow();
  });

  it("rejects uncompressed public keys", () => {
    expect(() => assertValidPubkeysHex([publicKey.toHex(false)])).toThrow("Invalid pubkey length 96");
  });

  it("rejects public keys with too few bytes", () => {
    expect(() => assertValidPubkeysHex(["0x1234"])).toThrow("Invalid pubkey length 2");
  });
});
