import {assert} from "chai";
import {bigIntMin, bigIntMax, intDiv, intSqrt, bigIntSqrt} from "../../src";


describe("util/maths", function() {

  describe("bigIntMin", () => {
    it("if a is lt should return a", () => {
      const a = 1n;
      const b = 2n;
      const result = bigIntMin(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is lt should return b", () => {
      const a = 3n;
      const b = 2n;
      const result = bigIntMin(a, b);
      assert.equal(result, b, "Should have returned b!");
    });
  });

  describe("bigIntMax", () => {
    it("if a is gt should return a", () => {
      const a = 2n;
      const b = 1n;
      const result = bigIntMax(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is gt should return b", () => {
      const a = 2n;
      const b = 3n;
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
      const result = bigIntSqrt(0n);
      assert.equal(result.toString(), 0n.toString(), "Should have returned 0!");
    });
    it("1 should return 1", () => {
      const result = bigIntSqrt(1n);
      assert.equal(result.toString(), 1n.toString(), "Should have returned 1!");
    });
    it("3 should return 1", () => {
      const result = bigIntSqrt(3n);
      assert.equal(result.toString(), 1n.toString(), "Should have returned 1!");
    });
    it("4 should return 2", () => {
      const result = bigIntSqrt(4n);
      assert.equal(result.toString(), 2n.toString(), "Should have returned 2!");
    });
    it("16 should return 4", () => {
      const result = bigIntSqrt(16n);
      assert.equal(result.toString(), 4n.toString(), "Should have returned 4!");
    });
    it("31 should return 5", () => {
      const result = bigIntSqrt(31n);
      assert.equal(result.toString(), 5n.toString(), "Should have returned 5!");
    });
  });
});
