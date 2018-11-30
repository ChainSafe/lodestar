import { assert } from 'chai';
import { split } from "../../helpers/stateTransition";

describe('Split', function() {
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
