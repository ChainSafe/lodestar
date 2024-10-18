import {describe, it, expect} from "vitest";
import {isValidatePubkeyHex, parseRange} from "../../../src/util/index.js";

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
