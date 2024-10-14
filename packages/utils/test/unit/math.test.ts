import {describe, it, expect} from "vitest";
import {bigIntMin, bigIntMax, intDiv, intSqrt, bigIntSqrt} from "../../src/index.js";

describe("util/maths", () => {
  describe("bigIntMin", () => {
    it("if a is lt should return a", () => {
      const a = BigInt(1);
      const b = BigInt(2);
      const result = bigIntMin(a, b);
      expect(result).toBe(a);
    });
    it("if b is lt should return b", () => {
      const a = BigInt(3);
      const b = BigInt(2);
      const result = bigIntMin(a, b);
      expect(result).toBe(b);
    });
  });

  describe("bigIntMax", () => {
    it("if a is gt should return a", () => {
      const a = BigInt(2);
      const b = BigInt(1);
      const result = bigIntMax(a, b);
      expect(result).toBe(a);
    });
    it("if b is gt should return b", () => {
      const a = BigInt(2);
      const b = BigInt(3);
      const result = bigIntMax(a, b);
      expect(result).toBe(b);
    });
  });

  describe("intDiv", () => {
    it("should divide whole number", () => {
      const result = intDiv(6, 3);
      expect(result).toBe(2);
    });
    it("should round less division", () => {
      const result = intDiv(9, 8);
      expect(result).toBe(1);
    });
  });

  describe("intSqrt", () => {
    it("0 should return 0", () => {
      const result = intSqrt(0);
      expect(result).toBe(0);
    });
    it("1 should return 1", () => {
      const result = intSqrt(1);
      expect(result).toBe(1);
    });
    it("3 should return 1", () => {
      const result = intSqrt(3);
      expect(result).toBe(1);
    });
    it("4 should return 2", () => {
      const result = intSqrt(4);
      expect(result).toBe(2);
    });
    it("16 should return 4", () => {
      const result = intSqrt(16);
      expect(result).toBe(4);
    });
    it("31 should return 5", () => {
      const result = intSqrt(31);
      expect(result).toBe(5);
    });
  });

  describe("bigIntSqrt", () => {
    it("0 should return 0", () => {
      const result = bigIntSqrt(BigInt(0));
      expect(result.toString()).toBe(BigInt(0).toString());
    });
    it("1 should return 1", () => {
      const result = bigIntSqrt(BigInt(1));
      expect(result.toString()).toBe(BigInt(1).toString());
    });
    it("3 should return 1", () => {
      const result = bigIntSqrt(BigInt(3));
      expect(result.toString()).toBe(BigInt(1).toString());
    });
    it("4 should return 2", () => {
      const result = bigIntSqrt(BigInt(4));
      expect(result.toString()).toBe(BigInt(2).toString());
    });
    it("16 should return 4", () => {
      const result = bigIntSqrt(BigInt(16));
      expect(result.toString()).toBe(BigInt(4).toString());
    });
    it("31 should return 5", () => {
      const result = bigIntSqrt(BigInt(31));
      expect(result.toString()).toBe(BigInt(5).toString());
    });
  });
});
