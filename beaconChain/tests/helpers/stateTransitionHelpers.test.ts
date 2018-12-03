import { assert } from 'chai';
import { split, clamp, intSqrt } from "../../helpers/stateTransitionHelpers";

describe('Split', function() {
  it('array of 0 should return empty', function() {
    const array = [];
    const answer = [[]];
    let result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it('array of 10 should split by a count of 1', function() {
    const array = [1,2,3,4,5,6,7,8,9,10];
    const answer = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
    let result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it('array of 10 should split by a count of 2', function() {
    const array = [1,2,3,4,5,6,7,8,9,10];
    const answer = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]];
    let result = split(array, 2);
    assert.deepEqual(result, answer);
  });

  it('array of 10 should split by a count of 3', function() {
    const array = [1,2,3,4,5,6,7,8,9,10];
    const answer = [[1, 2, 3], [4, 5, 6], [7, 8, 9, 10]];
    let result = split(array, 3);
    assert.deepEqual(result, answer);
  });

  it('array of 10 should split by a count of 4', function() {
    const array = [1,2,3,4,5,6,7,8,9,10];
    const answer = [[1, 2], [3, 4, 5], [6, 7], [8, 9, 10]];
    let result = split(array, 4);
    assert.deepEqual(result, answer);
  });

  it('array of 7 should split by a count of 1', function() {
    const array = [1,2,3,4,5,6,7];
    const answer = [[1, 2, 3, 4, 5, 6, 7]];
    let result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it('array of 7 should split by a count of 2', function() {
    const array = [1,2,3,4,5,6,7];
    const answer = [[1, 2, 3], [4, 5, 6, 7]];
    let result = split(array, 2);
    assert.deepEqual(result, answer);
  });

  it('array of 7 should split by a count of 3', function() {
    const array = [1,2,3,4,5,6,7];
    const answer = [[1, 2], [3, 4], [5, 6, 7]];
    let result = split(array, 3);
    assert.deepEqual(result, answer);
  });

  it('array of 7 should split by a count of 4', function() {
    const array = [1,2,3,4,5,6,7];
    const answer = [[1], [2, 3], [4, 5], [6, 7]];
    let result = split(array, 4);
    assert.deepEqual(result, answer);
  });
});

describe('Clamp', function() {
  it('should return upper bound', function () {
    const result = clamp(2, 4, 5);
    assert.equal(result, 4, "Should have returned 4!");
  });

  it('should return upper bound', function () {
    const result = clamp(2, 4, 4);
    assert.equal(result, 4, "Should have returned 4!");
  });

  it('should return the lower bound', function () {
    const result = clamp(2, 4, 1);
    assert.equal(result, 2, "Should have returned 2!");
  });

  it('should return the lower bound', function () {
    const result = clamp(2, 4, 2);
    assert.equal(result, 2, "Should have returned 2!");
  });

  it('should return the inbetween value', function () {
    const result = clamp(2, 4, 3);
    assert.equal(result, 3, "Should have returned 3!");
  });
});


describe('intSqrt', function() {
  it('0 should return 0', function () {
    const result = intSqrt(0);
    assert.equal(result, 0, "Should have returned 0!");
  });

  it('1 should return 1', function () {
    const result = intSqrt(1);
    assert.equal(result, 1, "Should have returned 1!");
  });

  it('3 should return 1', function () {
    const result = intSqrt(3);
    assert.equal(result, 1, "Should have returned 1!");
  });

  it('4 should return 2', function () {
    const result = intSqrt(4);
    assert.equal(result, 2, "Should have returned 2!");
  });

  it('16 should return 4', function () {
    const result = intSqrt(16);
    assert.equal(result, 4, "Should have returned 4!");
  });

  it('31 should return 5', function () {
    const result = intSqrt(31);
    assert.equal(result, 5, "Should have returned 5!");
  });
});

