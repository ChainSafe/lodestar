import { assert } from "chai";

import {
  intSqrt,
  bnMin, bnMax, intDiv, bnSqrt
} from "../../../src/util/math";
import BN from "bn.js";


describe('util/maths', function() {

  describe("bnMin", () => {
    it("if a is lt should return a", () => {
      const a = new BN('1');
      const b = new BN('2');
      const result = bnMin(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is lt should return b", () => {
      const a = new BN('3');
      const b = new BN('2');
      const result = bnMin(a, b);
      assert.equal(result, b, "Should have returned b!");
    });
  });

  describe("bnMax", () => {
    it("if a is gt should return a", () => {
      const a = new BN('2');
      const b = new BN('1');
      const result = bnMax(a, b);
      assert.equal(result, a, "Should have returned a!");
    });
    it("if b is gt should return b", () => {
      const a = new BN('2');
      const b = new BN('3');
      const result = bnMax(a, b);
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

  describe("bnSqrt", () => {
    it("0 should return 0", () => {
      const result = bnSqrt(new BN('0'));
      assert.equal(result.toString(), new BN('0').toString(), "Should have returned 0!");
    });
    it("1 should return 1", () => {
      const result = bnSqrt(new BN('1'));
      assert.equal(result.toString(), new BN('1').toString(), "Should have returned 1!");
    });
    it("3 should return 1", () => {
      const result = bnSqrt(new BN('3'));
      assert.equal(result.toString(), new BN('1').toString(), "Should have returned 1!");
    });
    it("4 should return 2", () => {
      const result = bnSqrt(new BN('4'));
      assert.equal(result.toString(), new BN('2').toString(), "Should have returned 2!");
    });
    it("16 should return 4", () => {
      const result = bnSqrt(new BN('16'));
      assert.equal(result.toString(), new BN('4').toString(), "Should have returned 4!");
    });
    it("31 should return 5", () => {
      const result = bnSqrt(new BN('31'));
      assert.equal(result.toString(), new BN('5').toString(), "Should have returned 5!");
    });
  });
});
