import "../setup.js";
import {assert} from "chai";
import {bigIntMin, bigIntMax, intDiv, intSqrt, bigIntSqrt} from "../../src/index.js";

describe("util/maths", function () {
  describe("bigIntMin", () => {
    it("if a is lt should return a", () => {
      const a = BigInt(1);
      const b = BigInt(2);
      const result = bigIntMin(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is lt should return b", () => {
      const a = BigInt(3);
      const b = BigInt(2);
      const result = bigIntMin(a, b);
      assert.equal(result, b, "Should have returned b!");
    });
  });

  describe("bigIntMax", () => {
    it("if a is gt should return a", () => {
      const a = BigInt(2);
      const b = BigInt(1);
      const result = bigIntMax(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is gt should return b", () => {
      const a = BigInt(2);
      const b = BigInt(3);
      const result = bigIntMax(a, b);
      assert.equal(result, b, "Should have returned b!");
    });
  });

  describe("intDiv", () => {
    it("should divide whole number", () => {
      const result = intDiv(6, 3);
      assert.equal(result, 2, "Should have returned 2!");
    });
    it("should round less division", () => {
      const result = intDiv(9, 8);
      assert.equal(result, 1, "Should have returned 1!");
    });
  });

  describe("intSqrt", () => {
    it("0 should return 0", () => {
      const result = intSqrt(0);
      assert.equal(result, 0, "Should have returned 0!");
    });
    it("1 should return 1", () => {
      const result = intSqrt(1);
      assert.equal(result, 1, "Should have returned 1!");
    });
    it("3 should return 1", () => {
      const result = intSqrt(3);
      assert.equal(result, 1, "Should have returned 1!");
    });
    it("4 should return 2", () => {
      const result = intSqrt(4);
      assert.equal(result, 2, "Should have returned 2!");
    });
    it("16 should return 4", () => {
      const result = intSqrt(16);
      assert.equal(result, 4, "Should have returned 4!");
    });
    it("31 should return 5", () => {
      const result = intSqrt(31);
      assert.equal(result, 5, "Should have returned 5!");
    });
  });

  describe("bigIntSqrt", () => {
    it("0 should return 0", () => {
      const result = bigIntSqrt(BigInt(0));
      assert.equal(result.toString(), BigInt(0).toString(), "Should have returned 0!");
    });
    it("1 should return 1", () => {
      const result = bigIntSqrt(BigInt(1));
      assert.equal(result.toString(), BigInt(1).toString(), "Should have returned 1!");
    });
    it("3 should return 1", () => {
      const result = bigIntSqrt(BigInt(3));
      assert.equal(result.toString(), BigInt(1).toString(), "Should have returned 1!");
    });
    it("4 should return 2", () => {
      const result = bigIntSqrt(BigInt(4));
      assert.equal(result.toString(), BigInt(2).toString(), "Should have returned 2!");
    });
    it("16 should return 4", () => {
      const result = bigIntSqrt(BigInt(16));
      assert.equal(result.toString(), BigInt(4).toString(), "Should have returned 4!");
    });
    it("31 should return 5", () => {
      const result = bigIntSqrt(BigInt(31));
      assert.equal(result.toString(), BigInt(5).toString(), "Should have returned 5!");
    });
  });
});
