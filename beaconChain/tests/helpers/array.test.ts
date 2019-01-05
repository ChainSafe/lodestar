import { assert } from "chai";
import { zip } from '../../helpers/array';

describe("Zip", () => {
  it("Should return an empty array", () => {
    const answer = [];
    const a = [];
    const b = [];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should return a two by two array", () => {
    const answer = [[1,3], [2,4]];
    const a = [1,2];
    const b = [3,4];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should support arrays of length 3", () => {
    const answer = [[1,4], [2,5], [3,6]];
    const a = [1,2,3];
    const b = [4,5,6];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should support arrays of length 4", () => {
    const answer = [[1,5], [2,6], [3,7], [4,8]];
    const a = [1,2,3,4];
    const b = [5,6,7,8];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should support strings", () => {
    const answer = [['a','c'], ['b','d']];
    const a = ['a','b'];
    const b = ['c','d'];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should return undefined at result[1][1]", () => {
    const answer = [[1,3], [2, undefined]];
    const a = [1,2];
    const b = [3];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });

  it("Should return undefined at result[0][1] and result[1][1]", () => {
    const answer = [[1,undefined], [2, undefined]];
    const a = [1,2];
    const b = [];
    const result = zip(a,b);
    assert.deepEqual(result, answer);
  });
});
