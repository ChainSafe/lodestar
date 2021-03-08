import {assert, expect} from "chai";
import {
  bigIntMin,
  bigIntMax,
  intDiv,
  intSqrt,
  bigIntSqrt,
  addUint8Array,
  subtractUint8ArrayGte0,
  compareUint8Array,
  increaseUint8Array,
  decreaseUint8ArrayGte0,
  calculateBigIntUint8Array,
} from "../../src";

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

  const uint8ArrayToNumber = (arr: Uint8Array): number => {
    let result = 0;
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] & 0xff;
      const toAdd = item * 2 ** (i * 8);
      result += toAdd;
    }
    return result;
  };

  describe("addUint8Array", () => {
    it("should add 2 arrays of same length", () => {
      const array1 = [
        Uint8Array.from([250, 255, 255, 255, 255, 255, 255, 0]),
        Uint8Array.from([250, 255, 255, 255, 255, 255, 0, 0]),
      ];
      // same to array1 with 1 addition at start and end
      const array2 = [
        Uint8Array.from([120, 250, 255, 255, 255, 255, 255, 255, 0, 120]),
        Uint8Array.from([240, 250, 255, 255, 255, 255, 255, 0, 0, 240]),
      ];
      const deltas = [Uint8Array.from([10, 0, 0, 0, 0, 0, 0]), Uint8Array.from([10, 0, 0, 0, 0, 0, 0])];
      const expected1 = [Uint8Array.from([4, 0, 0, 0, 0, 0, 0, 1]), Uint8Array.from([4, 0, 0, 0, 0, 0, 1, 0])];
      // same to expected1 with 1 addition item at start and end
      const expected2 = [
        Uint8Array.from([120, 4, 0, 0, 0, 0, 0, 0, 1, 120]),
        Uint8Array.from([240, 4, 0, 0, 0, 0, 0, 1, 0, 240]),
      ];
      for (let i = 0; i < array1.length; i++) {
        expect(addUint8Array(array1[i], deltas[i], 0)).to.be.deep.equal(expected1[i]);
        expect(uint8ArrayToNumber(array1[i]) + uint8ArrayToNumber(deltas[i])).to.be.equal(
          uint8ArrayToNumber(expected1[i])
        );
      }
      for (let i = 0; i < array2.length; i++) {
        expect(addUint8Array(array2[i], deltas[i], 1)).to.be.deep.equal(expected2[i]);
      }
    });
  });

  describe("subtractUint8ArrayGte0", () => {
    it("should subtract array of same length", () => {
      const arrays = [Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]), Uint8Array.from([0, 0, 255, 1, 0, 0, 0, 0])];
      // same to arrays with additional items at start and end
      const arrays2 = [
        Uint8Array.from([120, 0, 0, 0, 1, 0, 0, 0, 0, 120]),
        Uint8Array.from([240, 0, 0, 255, 1, 0, 0, 0, 0, 240]),
      ];
      const deltas = [Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0])];
      const expected = [
        Uint8Array.from([255, 255, 255, 0, 0, 0, 0, 0]),
        Uint8Array.from([255, 255, 254, 1, 0, 0, 0, 0]),
      ];
      // same to expected with additional items at start and end
      const expected2 = [
        Uint8Array.from([120, 255, 255, 255, 0, 0, 0, 0, 0, 120]),
        Uint8Array.from([240, 255, 255, 254, 1, 0, 0, 0, 0, 240]),
      ];
      for (let i = 0; i < arrays.length; i++) {
        expect(subtractUint8ArrayGte0(arrays[i], deltas[i], 0)).to.be.deep.equal(expected[i]);
        expect(uint8ArrayToNumber(arrays[i]) - uint8ArrayToNumber(deltas[i])).to.be.equal(
          uint8ArrayToNumber(expected[i])
        );
      }
      for (let i = 0; i < arrays.length; i++) {
        expect(subtractUint8ArrayGte0(arrays2[i], deltas[i], 1)).to.be.deep.equal(expected2[i]);
      }
    });

    it("should return at least 0", () => {
      const array1 = Uint8Array.from([255, 255, 255, 0, 0, 0, 0, 0]);
      // same to array1 with additional items at start and end
      const array2 = Uint8Array.from([120, 255, 255, 255, 0, 0, 0, 0, 0, 120]);
      // even bigger than array1
      const delta = Uint8Array.from([255, 255, 255, 1, 0, 0, 0, 0]);
      const expected = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0]);
      // same to expected with additional items at start and end
      const expected2 = Uint8Array.from([120, 0, 0, 0, 0, 0, 0, 0, 0, 120]);
      expect(subtractUint8ArrayGte0(array1, delta, 0)).to.be.deep.equal(expected);
      expect(subtractUint8ArrayGte0(array2, delta, 1)).to.be.deep.equal(expected2);
    });
  });

  describe("increaseUint8Array", () => {
    it("increaseUint8Array", () => {
      const testArr = Uint8Array.from([255, 255, 255, 1]);
      // same to testArr with additional items at start and end
      const testArr2 = Uint8Array.from([120, 255, 255, 255, 1, 120]);
      const deltas = [1, 10, 1000];
      const expected = [Uint8Array.from([0, 0, 0, 2]), Uint8Array.from([9, 0, 0, 2]), Uint8Array.from([231, 3, 0, 2])];
      // same to expected with additional items at start and end
      const expected2 = [
        Uint8Array.from([120, 0, 0, 0, 2, 120]),
        Uint8Array.from([120, 9, 0, 0, 2, 120]),
        Uint8Array.from([120, 231, 3, 0, 2, 120]),
      ];
      for (let i = 0; i < deltas.length; i++) {
        const arr = new Uint8Array(testArr.length);
        arr.set(testArr);
        increaseUint8Array(arr, deltas[i], 0, 4);
        expect(arr).to.be.deep.equal(expected[i]);
        expect(uint8ArrayToNumber(testArr) + deltas[i]).to.be.equal(uint8ArrayToNumber(expected[i]));
      }
      for (let i = 0; i < deltas.length; i++) {
        const arr = new Uint8Array(testArr2.length);
        arr.set(testArr2);
        increaseUint8Array(arr, deltas[i], 1, 4);
        expect(arr).to.be.deep.equal(expected2[i]);
      }
    });
  });

  describe("decreaseUint8ArrayGte0", () => {
    it("should result in a positive number", () => {
      const arrays = [Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]), Uint8Array.from([0, 0, 255, 1, 0, 0, 0, 0])];
      // same to arrays with additional items at start and end
      const arrays2 = [
        Uint8Array.from([120, 0, 0, 0, 1, 0, 0, 0, 0, 120]),
        Uint8Array.from([120, 0, 0, 255, 1, 0, 0, 0, 0, 120]),
      ];
      const deltas = [Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0])];
      const expected = [
        Uint8Array.from([255, 255, 255, 0, 0, 0, 0, 0]),
        Uint8Array.from([255, 255, 254, 1, 0, 0, 0, 0]),
      ];
      // same to expected with additional items at start and end
      const expected2 = [
        Uint8Array.from([120, 255, 255, 255, 0, 0, 0, 0, 0, 120]),
        Uint8Array.from([120, 255, 255, 254, 1, 0, 0, 0, 0, 120]),
      ];
      for (let i = 0; i < arrays.length; i++) {
        const arr = new Uint8Array(arrays[i].length);
        arr.set(arrays[i]);
        decreaseUint8ArrayGte0(arr, uint8ArrayToNumber(deltas[i]), 0, 8);
        expect(arr).to.be.deep.equal(expected[i]);
        expect(uint8ArrayToNumber(arrays[i]) - uint8ArrayToNumber(deltas[i])).to.be.equal(
          uint8ArrayToNumber(expected[i])
        );
      }
      for (let i = 0; i < arrays.length; i++) {
        const arr = new Uint8Array(arrays2[i].length);
        arr.set(arrays2[i]);
        decreaseUint8ArrayGte0(arr, uint8ArrayToNumber(deltas[i]), 1, 8);
        expect(arr).to.be.deep.equal(expected2[i]);
      }
    });
    // fix failed calculation when syncing pyrmont
    it("should decrease 27150", () => {
      const delta = 27150;
      // 32000038926n
      const initial = Uint8Array.from([14, 216, 89, 115, 7, 0, 0, 0]);
      const result = new Uint8Array(initial.length);
      result.set(initial);
      decreaseUint8ArrayGte0(result, delta, 0, 8);
      expect(result).to.be.deep.equal(Uint8Array.from([0, 110, 89, 115, 7, 0, 0, 0]));
      expect(uint8ArrayToNumber(result)).to.be.equal(32000011776);
    });

    it("should result in 0", () => {
      const arrays = [Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]), Uint8Array.from([0, 0, 255, 1, 0, 0, 0, 0])];
      // same to arrays with additional items at start and end
      const arrays2 = [
        Uint8Array.from([120, 0, 0, 0, 1, 0, 0, 0, 0, 120]),
        Uint8Array.from([120, 0, 0, 255, 1, 0, 0, 0, 0, 120]),
      ];
      const deltas = arrays.map(uint8ArrayToNumber).map((item) => item + 1000);
      const expected = new Uint8Array(8);
      // same to expected with additional items at start and end
      const expected2 = Uint8Array.from([120, 0, 0, 0, 0, 0, 0, 0, 0, 120]);
      for (let i = 0; i < arrays.length; i++) {
        const arr = new Uint8Array(arrays[i].length);
        arr.set(arrays[i]);
        decreaseUint8ArrayGte0(arr, deltas[i], 0, 8);
        expect(arr).to.be.deep.equal(expected);
      }
      for (let i = 0; i < arrays.length; i++) {
        const arr = new Uint8Array(arrays2[i].length);
        arr.set(arrays2[i]);
        decreaseUint8ArrayGte0(arr, deltas[i], 1, 8);
        expect(arr).to.be.deep.equal(expected2);
      }
    });
  });

  describe("calculateBigIntUint8Array", () => {
    it("should calculate a group of 2 bigints", () => {
      const bigIntArr = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1, 255, 255, 255, 255, 255, 255, 255, 0]);
      const delta = [-1, 1];
      const expected = Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
      expect(calculateBigIntUint8Array(bigIntArr, delta)).to.be.deep.equal(expected);
    });
  });

  describe("compareUint8Array", () => {
    it("different length", () => {
      expect(compareUint8Array(Uint8Array.from([4, 3, 2, 1]), Uint8Array.from([4, 3]))).to.be.equal(1);
      expect(compareUint8Array(Uint8Array.from([4, 3]), Uint8Array.from([4, 3, 2, 1]))).to.be.equal(-1);
      expect(compareUint8Array(Uint8Array.from([4, 3, 0, 0]), Uint8Array.from([4, 3]))).to.be.equal(0);
      expect(compareUint8Array(Uint8Array.from([4, 3]), Uint8Array.from([4, 3, 0, 0]))).to.be.equal(0);
    });

    it("same length", () => {
      expect(compareUint8Array(Uint8Array.from([4, 3, 2, 1]), Uint8Array.from([4, 3, 2, 0]))).to.be.equal(1);
      expect(compareUint8Array(Uint8Array.from([4, 3, 2, 0]), Uint8Array.from([4, 3, 2, 1]))).to.be.equal(-1);
      expect(compareUint8Array(Uint8Array.from([4, 3, 2, 0]), Uint8Array.from([4, 3, 2, 0]))).to.be.equal(0);
      expect(compareUint8Array(Uint8Array.from([4, 3, 2, 1]), Uint8Array.from([4, 3, 2, 1]))).to.be.equal(0);
    });
  });
});
