import {describe, expect, it} from "vitest";
import {formatBigDecimal, getCustodyGroupIncrements, prettyPrintCustodyGroups} from "../../src/format.js";

describe("format", () => {
  describe("formatBigDecimal", () => {
    const testCases: [bigint, bigint, bigint, string][] = [
      [BigInt("103797739275696858"), BigInt("1000000000000000000"), BigInt("100000"), "0.10379"],
      [BigInt("103797739275696858"), BigInt("1000000000000000000"), BigInt("1000"), "0.103"],
      [BigInt("10379773927569685"), BigInt("1000000000000000000"), BigInt("1000"), "0.010"],
      [BigInt("1037977392756968"), BigInt("1000000000000000000"), BigInt("1000"), "0.001"],
      [BigInt("1037977392756968"), BigInt("1000000000000000000"), BigInt("100000"), "0.00103"],
      [BigInt("58200000000000000"), BigInt("1000000000000000000"), BigInt("100000"), "0.05820"],
      [BigInt("111103797739275696858"), BigInt("1000000000000000000"), BigInt("100000"), "111.10379"],
      [BigInt("111103797739275696858"), BigInt("1000000000000000000"), BigInt("1000"), "111.103"],
      [BigInt("1037977392756"), BigInt("1000000000000000000"), BigInt("100000"), "0.00000"],
    ];
    for (const [numerator, denominator, decimalFactor, expectedString] of testCases) {
      it(`format ${numerator} / ${denominator} correctly to ${expectedString}`, () => {
        expect(formatBigDecimal(numerator, denominator, decimalFactor)).toBe(expectedString);
      });
    }
  });

  describe("getCustodyGroupIncrements", () => {
    it("should handle empty array", () => {
      expect(getCustodyGroupIncrements([])).toEqual([]);
    });

    it("should handle single element", () => {
      expect(getCustodyGroupIncrements([5])).toEqual(["5"]);
    });

    it("should handle two consecutive elements", () => {
      expect(getCustodyGroupIncrements([5, 6])).toEqual(["5-6"]);
    });

    it("should handle two non-consecutive elements", () => {
      expect(getCustodyGroupIncrements([5, 8])).toEqual(["5", "8"]);
    });

    it("should handle all consecutive elements", () => {
      expect(getCustodyGroupIncrements([0, 1, 2, 3, 4])).toEqual(["0-4"]);
    });

    it("should handle no consecutive elements", () => {
      expect(getCustodyGroupIncrements([1, 3, 5, 7, 9])).toEqual(["1", "3", "5", "7", "9"]);
    });

    it("should handle mixed ranges and singles", () => {
      expect(getCustodyGroupIncrements([0, 1, 2, 5, 10, 11, 12, 13, 20, 25, 26])).toEqual([
        "0-2",
        "5",
        "10-13",
        "20",
        "25-26",
      ]);
    });

    it("should handle the example case from requirements", () => {
      expect(getCustodyGroupIncrements([1, 3, 6, 24, 111, 112, 113, 127])).toEqual([
        "1",
        "3",
        "6",
        "24",
        "111-113",
        "127",
      ]);
    });

    it("should handle full range 0-127", () => {
      const fullRange = Array.from({length: 128}, (_, i) => i);
      expect(getCustodyGroupIncrements(fullRange)).toEqual(["0-127"]);
    });

    it("should handle minimum case with 4 elements", () => {
      expect(getCustodyGroupIncrements([10, 20, 30, 40])).toEqual(["10", "20", "30", "40"]);
    });

    it("should handle consecutive ranges at boundaries", () => {
      expect(getCustodyGroupIncrements([0, 1, 126, 127])).toEqual(["0-1", "126-127"]);
    });

    it("should handle large consecutive range in middle", () => {
      expect(getCustodyGroupIncrements([5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 100])).toEqual([
        "5",
        "10-20",
        "100",
      ]);
    });

    it("should handle alternating pattern", () => {
      expect(getCustodyGroupIncrements([1, 2, 4, 5, 7, 8, 10, 11])).toEqual(["1-2", "4-5", "7-8", "10-11"]);
    });
  });

  describe("prettyPrintCustodyGroups", () => {
    it("should format empty array", () => {
      expect(prettyPrintCustodyGroups([])).toBe("[]");
    });

    it("should format single element", () => {
      expect(prettyPrintCustodyGroups([5])).toBe("[5]");
    });

    it("should format the example case from requirements", () => {
      expect(prettyPrintCustodyGroups([1, 3, 6, 24, 111, 112, 113, 127])).toBe("[1, 3, 6, 24, 111-113, 127]");
    });

    it("should format all consecutive elements", () => {
      expect(prettyPrintCustodyGroups([0, 1, 2, 3, 4])).toBe("[0-4]");
    });

    it("should format no consecutive elements", () => {
      expect(prettyPrintCustodyGroups([1, 3, 5, 7, 9])).toBe("[1, 3, 5, 7, 9]");
    });

    it("should format mixed ranges and singles", () => {
      expect(prettyPrintCustodyGroups([0, 1, 2, 5, 10, 11, 12, 13, 20, 25, 26])).toBe("[0-2, 5, 10-13, 20, 25-26]");
    });

    it("should format full range 0-127", () => {
      const fullRange = Array.from({length: 128}, (_, i) => i);
      expect(prettyPrintCustodyGroups(fullRange)).toBe("[0-127]");
    });
  });
});
