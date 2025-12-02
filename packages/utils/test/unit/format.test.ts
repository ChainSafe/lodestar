import {describe, expect, it} from "vitest";
import {formatBigDecimal, groupSequentialIndices, prettyPrintIndices} from "../../src/format.js";

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

  describe("groupSequentialIndices", () => {
    it("should handle empty array", () => {
      expect(groupSequentialIndices([])).toEqual([]);
    });

    it("should handle single element", () => {
      expect(groupSequentialIndices([5])).toEqual(["5"]);
    });

    it("should handle two consecutive elements", () => {
      expect(groupSequentialIndices([5, 6])).toEqual(["5-6"]);
    });

    it("should handle two non-consecutive elements", () => {
      expect(groupSequentialIndices([5, 8])).toEqual(["5", "8"]);
    });

    it("should handle all consecutive elements", () => {
      expect(groupSequentialIndices([0, 1, 2, 3, 4])).toEqual(["0-4"]);
    });

    it("should handle no consecutive elements", () => {
      expect(groupSequentialIndices([1, 3, 5, 7, 9])).toEqual(["1", "3", "5", "7", "9"]);
    });

    it("should handle mixed ranges and singles", () => {
      expect(groupSequentialIndices([0, 1, 2, 5, 10, 11, 12, 13, 20, 25, 26])).toEqual([
        "0-2",
        "5",
        "10-13",
        "20",
        "25-26",
      ]);
    });

    it("should handle the example case from requirements", () => {
      expect(groupSequentialIndices([1, 3, 6, 24, 111, 112, 113, 127])).toEqual([
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
      expect(groupSequentialIndices(fullRange)).toEqual(["0-127"]);
    });

    it("should handle minimum case with 4 elements", () => {
      expect(groupSequentialIndices([10, 20, 30, 40])).toEqual(["10", "20", "30", "40"]);
    });

    it("should handle consecutive ranges at boundaries", () => {
      expect(groupSequentialIndices([0, 1, 126, 127])).toEqual(["0-1", "126-127"]);
    });

    it("should handle large consecutive range in middle", () => {
      expect(groupSequentialIndices([5, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 100])).toEqual([
        "5",
        "10-20",
        "100",
      ]);
    });

    it("should handle alternating pattern", () => {
      expect(groupSequentialIndices([1, 2, 4, 5, 7, 8, 10, 11])).toEqual(["1-2", "4-5", "7-8", "10-11"]);
    });

    // Tests for unsorted input arrays
    it("should handle unsorted array with mixed ranges", () => {
      expect(groupSequentialIndices([127, 1, 113, 3, 111, 6, 112, 24])).toEqual([
        "1",
        "3",
        "6",
        "24",
        "111-113",
        "127",
      ]);
    });

    it("should handle completely reversed array", () => {
      expect(groupSequentialIndices([9, 7, 5, 3, 1])).toEqual(["1", "3", "5", "7", "9"]);
    });

    it("should handle unsorted consecutive elements", () => {
      expect(groupSequentialIndices([4, 2, 3, 0, 1])).toEqual(["0-4"]);
    });

    it("should handle unsorted mixed ranges and singles", () => {
      expect(groupSequentialIndices([26, 20, 25, 13, 10, 12, 11, 5, 2, 1, 0])).toEqual([
        "0-2",
        "5",
        "10-13",
        "20",
        "25-26",
      ]);
    });

    it("should handle randomly shuffled full range", () => {
      const shuffledRange = [50, 0, 100, 25, 127, 75, 1, 126, 2, 124, 3, 123];
      expect(groupSequentialIndices(shuffledRange)).toEqual(["0-3", "25", "50", "75", "100", "123-124", "126-127"]);
    });

    it("should handle unsorted duplicates (should be handled by sort)", () => {
      expect(groupSequentialIndices([5, 3, 5, 1, 3, 1])).toEqual(["1", "3", "5"]);
    });
  });

  describe("prettyPrintIndices", () => {
    it("should format empty array", () => {
      expect(prettyPrintIndices([])).toBe("[]");
    });

    it("should format single element", () => {
      expect(prettyPrintIndices([5])).toBe("[5]");
    });

    it("should format the example case from requirements", () => {
      expect(prettyPrintIndices([1, 3, 6, 24, 111, 112, 113, 127])).toBe("[1, 3, 6, 24, 111-113, 127]");
    });

    it("should format all consecutive elements", () => {
      expect(prettyPrintIndices([0, 1, 2, 3, 4])).toBe("[0-4]");
    });

    it("should format no consecutive elements", () => {
      expect(prettyPrintIndices([1, 3, 5, 7, 9])).toBe("[1, 3, 5, 7, 9]");
    });

    it("should format mixed ranges and singles", () => {
      expect(prettyPrintIndices([0, 1, 2, 5, 10, 11, 12, 13, 20, 25, 26])).toBe("[0-2, 5, 10-13, 20, 25-26]");
    });

    it("should format full range 0-127", () => {
      const fullRange = Array.from({length: 128}, (_, i) => i);
      expect(prettyPrintIndices(fullRange)).toBe("[0-127]");
    });

    it("should format unsorted array correctly", () => {
      expect(prettyPrintIndices([127, 1, 113, 3, 111, 6, 112, 24])).toBe("[1, 3, 6, 24, 111-113, 127]");
    });
  });
});
