import { assert } from "chai";
import {
  clamp, getActiveValidatorIndices, getEpochStartSlot, intSqrt, isActiveValidator, readUIntBE, slotToEpoch, split,
} from "../../helpers/stateTransitionHelpers";
import {EpochNumber, SlotNumber, Validator} from "../../types";
import {generateMnemonic} from "bip39";
import {generateValidator} from "../utils/validator";

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

describe("slotToEpoch", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 0},
    {test: 10, expected: 0},
    {test: 100, expected: 1},
    {test: 1000, expected: 15},
    {test: 10000, expected: 156},
    {test: 100000, expected: 1562},
    {test: 1000000, expected: 15625},
  ];
  for (const pair of pairs) {
    it(`Return ${pair.expected} a value of ${pair.test}`, () => {
      const result: EpochNumber = slotToEpoch(pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("getEpochStartSlot", () => {
  const pairs = [
    {test: 0, expected: 0},
    {test: 1, expected: 64},
    {test: 10, expected: 640},
    {test: 100, expected: 6400},
    {test: 1000, expected: 64000},
    {test: 10000, expected: 640000},
    {test: 100000, expected: 6400000},
    {test: 1000000, expected: 64000000},
  ];
  for (const pair of pairs) {
    it(`Return ${pair.expected} a value of ${pair.test}`, () => {
      const result: SlotNumber = getEpochStartSlot(pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator(0, 100);
    const result: boolean = isActiveValidator(v, 0);
    assert.equal(result, true);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(10, 101);
    const result: boolean = isActiveValidator(v, 100);
    assert.equal(result, true);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(100, 1000);
    const result: boolean = isActiveValidator(v, 100);
    assert.equal(result, true);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1);
    const result: boolean = isActiveValidator(v, 0);
    assert.equal(result, false);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(100);
    const result: boolean = isActiveValidator(v, 5);
    assert.equal(result, false);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1, 5);
    const result: boolean = isActiveValidator(v, 100);
    assert.equal(result, false);
  });
});
