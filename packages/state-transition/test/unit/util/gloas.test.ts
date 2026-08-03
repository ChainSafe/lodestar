import {describe, expect, it} from "vitest";
import {getExpectedGasLimit, isGasLimitTargetCompatible} from "../../../src/util/gloas.js";

describe("util / gloas", () => {
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

  describe("isGasLimitTargetCompatible", () => {
    it("compares bigint gas limits without rounding above Number.MAX_SAFE_INTEGER", () => {
      const parentGasLimit = 9_007_199_254_740_993n;
      const expectedGasLimit = 9_007_199_254_749_788n;
      const roundedGasLimit = 9_007_199_254_749_787n;

      expect(isGasLimitTargetCompatible(parentGasLimit, expectedGasLimit, expectedGasLimit)).toBe(true);
      expect(isGasLimitTargetCompatible(parentGasLimit, roundedGasLimit, expectedGasLimit)).toBe(false);
    });
  });
});
