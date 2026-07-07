import {describe, expect, it} from "vitest";
import {
  BUILDER_WITHDRAWAL_PREFIX_MAX,
  BUILDER_WITHDRAWAL_PREFIX_MIN,
  PAYLOAD_BUILDER_WITHDRAWAL_PREFIX,
} from "@lodestar/params";
import {
  getExpectedGasLimit,
  hasBuilderWithdrawalCredentialPrefix,
  isBuilderWithdrawalCredential,
} from "../../../src/util/gloas.js";

describe("util / gloas", () => {
  describe("builder withdrawal credentials", () => {
    function credentials(firstByte: number): Uint8Array {
      const withdrawalCredentials = new Uint8Array(32);
      withdrawalCredentials[0] = firstByte;
      return withdrawalCredentials;
    }

    it("detects only the exact fork-time builder withdrawal credential", () => {
      expect(isBuilderWithdrawalCredential(credentials(PAYLOAD_BUILDER_WITHDRAWAL_PREFIX[0]))).toBe(true);
      expect(isBuilderWithdrawalCredential(credentials(BUILDER_WITHDRAWAL_PREFIX_MAX))).toBe(false);
      expect(isBuilderWithdrawalCredential(credentials(0xaf))).toBe(false);
      expect(isBuilderWithdrawalCredential(credentials(0xc0))).toBe(false);
    });

    it("detects the builder withdrawal credential prefix range for builder deposit requests", () => {
      expect(hasBuilderWithdrawalCredentialPrefix(credentials(BUILDER_WITHDRAWAL_PREFIX_MIN))).toBe(true);
      expect(hasBuilderWithdrawalCredentialPrefix(credentials(BUILDER_WITHDRAWAL_PREFIX_MAX))).toBe(true);
      expect(hasBuilderWithdrawalCredentialPrefix(credentials(0xaf))).toBe(false);
      expect(hasBuilderWithdrawalCredentialPrefix(credentials(0xc0))).toBe(false);
    });
  });

  describe("getExpectedGasLimit", () => {
    const testCases: {
      name: string;
      parentGasLimit: number;
      targetGasLimit: number;
      expected: number;
    }[] = [
      {
        name: "Increase within limit",
        parentGasLimit: 30000000,
        targetGasLimit: 30000100,
        expected: 30000100,
      },
      {
        name: "Increase exceeding limit",
        parentGasLimit: 30000000,
        targetGasLimit: 36000000,
        expected: 30029295, // maxGasLimitDifference = (30000000 / 1024) - 1 = 29295
      },
      {
        name: "Decrease within limit",
        parentGasLimit: 30000000,
        targetGasLimit: 29999990,
        expected: 29999990,
      },
      {
        name: "Decrease exceeding limit",
        parentGasLimit: 36000000,
        targetGasLimit: 30000000,
        expected: 35964845, // maxGasLimitDifference = (36000000 / 1024) - 1 = 35155
      },
      {
        name: "Target equals parent",
        parentGasLimit: 30000000,
        targetGasLimit: 30000000,
        expected: 30000000, // No change
      },
      {
        name: "Very small parent gas limit",
        parentGasLimit: 1025,
        targetGasLimit: 2000,
        expected: 1025,
      },
      {
        name: "Target far below parent but limited",
        parentGasLimit: 30000000,
        targetGasLimit: 10000000,
        expected: 29970705, // maxGasLimitDifference = (30000000 / 1024) - 1 = 29295
      },
      {
        name: "Parent gas limit underflows",
        parentGasLimit: 1023,
        targetGasLimit: 30000000,
        expected: 1023,
      },
    ];

    it.each(testCases)("$name", ({parentGasLimit, targetGasLimit, expected}) => {
      expect(getExpectedGasLimit(parentGasLimit, targetGasLimit)).toBe(expected);
    });
  });
});
