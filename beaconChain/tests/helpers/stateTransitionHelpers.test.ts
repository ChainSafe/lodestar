import { assert } from "chai";
import { clamp, getActiveValidatorIndices, intSqrt, isPowerOfTwo, readUIntBE, split } from "../../helpers/stateTransitionHelpers";
import { Validator } from "../../types";

type int = number;

describe("Split", () => {
  it("array of 0 should return empty", () => {
    const array: any[] = [];
    const answer = [[]];
    const result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it("array of 10 should split by a count of 1", () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const answer = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
    const result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it("array of 10 should split by a count of 2", () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const answer = [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]];
    const result = split(array, 2);
    assert.deepEqual(result, answer);
  });

  it("array of 10 should split by a count of 3", () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const answer = [[1, 2, 3], [4, 5, 6], [7, 8, 9, 10]];
    const result = split(array, 3);
    assert.deepEqual(result, answer);
  });

  it("array of 10 should split by a count of 4", () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const answer = [[1, 2], [3, 4, 5], [6, 7], [8, 9, 10]];
    const result = split(array, 4);
    assert.deepEqual(result, answer);
  });

  it("array of 7 should split by a count of 1", () => {
    const array = [1, 2, 3, 4, 5, 6, 7];
    const answer = [[1, 2, 3, 4, 5, 6, 7]];
    const result = split(array, 1);
    assert.deepEqual(result, answer);
  });

  it("array of 7 should split by a count of 2", () => {
    const array = [1, 2, 3, 4, 5, 6, 7];
    const answer = [[1, 2, 3], [4, 5, 6, 7]];
    const result = split(array, 2);
    assert.deepEqual(result, answer);
  });

  it("array of 7 should split by a count of 3", () => {
    const array = [1, 2, 3, 4, 5, 6, 7];
    const answer = [[1, 2], [3, 4], [5, 6, 7]];
    const result = split(array, 3);
    assert.deepEqual(result, answer);
  });

  it("array of 7 should split by a count of 4", () => {
    const array = [1, 2, 3, 4, 5, 6, 7];
    const answer = [[1], [2, 3], [4, 5], [6, 7]];
    const result = split(array, 4);
    assert.deepEqual(result, answer);
  });
});

describe("Clamp", () => {
  it("should return upper bound", () => {
    const result = clamp(2, 4, 5);
    assert.equal(result, 4, "Should have returned 4!");
  });

  it("should return upper bound", () => {
    const result = clamp(2, 4, 4);
    assert.equal(result, 4, "Should have returned 4!");
  });

  it("should return the lower bound", () => {
    const result = clamp(2, 4, 1);
    assert.equal(result, 2, "Should have returned 2!");
  });

  it("should return the lower bound", () => {
    const result = clamp(2, 4, 2);
    assert.equal(result, 2, "Should have returned 2!");
  });

  it("should return the inbetween value", () => {
    const result = clamp(2, 4, 3);
    assert.equal(result, 3, "Should have returned 3!");
  });
});

describe("isPowerOfTwo", () => {
  it("0 should return false", () => {
    const result = isPowerOfTwo(0);
    assert.equal(result, false, "Should have returned false!");
  });

  it("1 should return true", () => {
    const result = isPowerOfTwo(1);
    assert.equal(result, true, "Should have returned true!");
  });

  it("2 should return true", () => {
    const result = isPowerOfTwo(2);
    assert.equal(result, true, "Should have returned true!");
  });

  it("3 should return false", () => {
    const result = isPowerOfTwo(3);
    assert.equal(result, false, "Should have returned false!");
  });

  it("Numbers close to 2**32 should return false", () => {
    for (let i: int = 2; i < 53; i++) {
      const result = isPowerOfTwo(2 ** i);
      assert.equal(result, true, "Should have returned true!");
      const result1 = isPowerOfTwo(2 ** i - 1);
      assert.equal(result1, false, "Should have returned false!");
      const result2 = isPowerOfTwo(2 ** i + 1);
      assert.equal(result2, false, "Should have returned false!");
    }
  });

  it("Should throw if a negative number is passed in", () => {
    assert.throws(function() { isPowerOfTwo(-1) });
  });

  it("Should throw if a value greater or equal to 2 ** 53 is passed in", () => {
    // TODO: Remove this when we are able to support larger values.
    assert.throws(function() { isPowerOfTwo(2 ** 53) });
    assert.throws(function() { isPowerOfTwo(2 ** 53 + 1) });
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

describe("getActiveValidatorIndices", () => {
  const randNum = () =>  Math.floor(Math.random() * Math.floor(4));
  const genValidator = (): Validator => ({
    pubkey: new Uint8Array(48),
    withdrawalCredentials: Uint8Array.of(65),
    activationEpoch: randNum(),
    exitEpoch: randNum(),
    withdrawalEpoch: randNum(),
    penalizedEpoch: randNum(),
    statusFlags: randNum(),
  });
  const vrArray: Validator[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(genValidator);

  it("empty list of Validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices([], randNum()), []);
  });

  // it("list of all active Validators should return a list of all indices", () => {
  //   const allActive = vrArray.map((vr) => ({...vr, status: ValidatorStatusCodes.ACTIVE}));
  //   const indices = vrArray.map((_, i) => i);
  //   const activeIndices = getActiveValidatorIndices(allActive, 0);
  //
  //   assert.equal(allActive.length, activeIndices.length);
  //   assert.deepEqual(indices, activeIndices);
  // });
  //
  // it("list of no active Validators should return an empty list", () => {
  //   const noActive = vrArray.map((vr) => ({...vr, status: ValidatorStatusCodes.PENDING_ACTIVATION}));
  //
  //   assert.deepEqual(getActiveValidatorIndices(noActive), []);
  // });
  //
  // it("list of random mixed Validators should return a filtered and mutated list", () => {
  //   const filtered = vrArray.filter((vr) => vr.status === ValidatorStatusCodes.ACTIVE);
  //   const getAVI = getActiveValidatorIndices(vrArray);
  //
  //   assert(filtered.length === getAVI.length);
  // });
});

describe("readUIntBE", () => {
  const buf = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);

  it("Read uints should be calculated correctly", () => {
    assert.strictEqual(readUIntBE(buf, 0, 1), 0x01);
    assert.strictEqual(readUIntBE(buf, 0, 3), 0x010203);
    assert.strictEqual(readUIntBE(buf, 0, 5), 0x0102030405);
    assert.strictEqual(readUIntBE(buf, 0, 6), 0x010203040506);
  });
});

// describe("getShuffling", () => {
//   const seed = Uint8Array.of(65);
//   const validators = Array.from({ length: 1000 }, () => ({} as Validator));
//   const shuffled = getShuffling(seed, validators, 0);
//   const exists = (shuffling: ShardCommittee[][], validatorIndex: number): boolean => {
//     return !!shuffling.find((shardCommittees) => {
//       return !!shardCommittees.find((shardCommittee) => {
//         return shardCommittee.committee.includes(validatorIndex);
//       });
//     });
//   };
//   it("Shuffled committees should include all validators in unshuffled set", () => {
//     validators.forEach((v, index) => assert(exists(shuffled, index)));
//   });
// });
