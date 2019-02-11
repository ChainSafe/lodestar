import { assert } from "chai";
import BN from "bn.js";

import { EPOCH_LENGTH, TARGET_COMMITTEE_SIZE } from "../../constants";
import {
  clamp, getActiveValidatorIndices, getEpochStartSlot, intSqrt, isActiveValidator, isPowerOfTwo, readUIntBE,
  slotToEpoch, split, isDoubleVote, getCurrentEpoch, getForkVersion, getDomain, getEpochCommitteeCount
} from "../../helpers/stateTransitionHelpers";
import {EpochNumber, Fork, SlotNumber, uint64, Validator} from "../../types";
import {generateValidator} from "../utils/validator";
import {generateAttestationData} from "../utils/attestation";
import {randBetween} from "../utils/misc";

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
    const result = isPowerOfTwo(new BN(0));
    assert.equal(result, false, "Should have returned false!");
  });

  it("1 should return true", () => {
    const result = isPowerOfTwo(new BN(1));
    assert.equal(result, true, "Should have returned true!");
  });

  it("2 should return true", () => {
    const result = isPowerOfTwo(new BN(2));
    assert.equal(result, true, "Should have returned true!");
  });

  it("3 should return false", () => {
    const result = isPowerOfTwo(new BN(3));
    assert.equal(result, false, "Should have returned false!");
  });

  it("Numbers close to 2**257 should return false", () => {
    for (let i: int = 2; i < 257; i++) {
      const powOfTwo = new BN(2).pow(new BN(i));
      const result = isPowerOfTwo(powOfTwo);
      assert.equal(result, true, "Should have returned true!");
      const result1 = isPowerOfTwo(powOfTwo.subn(1));
      assert.equal(result1, false, "Should have returned false!");
      const result2 = isPowerOfTwo(powOfTwo.addn(1));
      assert.equal(result2, false, "Should have returned false!");
    }
  });

  it("Should throw if a negative number is passed in", () => {
    assert.throws(() => { isPowerOfTwo(new BN(-1)); });
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

describe("isDoubleVote", () => {
  it("Attestation data with the same epoch should return true", () => {
    const epoch = randBetween(1, 1000);
    const slot = epoch * EPOCH_LENGTH;
    const a1 = generateAttestationData(slot, randBetween(1, 1000));
    const a2 = generateAttestationData(slot + EPOCH_LENGTH - 1, randBetween(1, 1000));
    assert.isTrue(isDoubleVote(a1, a2));
  });

  it("Attestation data with different epochs should return false", () => {
    const epoch = randBetween(1, 1000);
    const slot = epoch * EPOCH_LENGTH;
    const a1 = generateAttestationData(slot, randBetween(1, 1000));
    const a2 = generateAttestationData(slot - 1, randBetween(1, 1000));
    assert.isFalse(isDoubleVote(a1, a2));
  });
});

describe("getActiveValidatorIndices", () => {
  const vrArray: Validator[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(generateValidator);

  it("empty list of Validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices([], new BN(randBetween(0, 4))), []);
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

describe("getEpochCommitteeCount", () => {
  // this defines the # of validators required to have 1 committee
  // per slot for epoch length.
  const validatorsPerEpoch = EPOCH_LENGTH * TARGET_COMMITTEE_SIZE;
  const tests = [
    {validatorCount: 0, committeeCount: EPOCH_LENGTH},
    {validatorCount: 1000, committeeCount: EPOCH_LENGTH},
    {validatorCount: 2 * validatorsPerEpoch, committeeCount: 2 * EPOCH_LENGTH},
    {validatorCount: 5 * validatorsPerEpoch, committeeCount: 5 * EPOCH_LENGTH},
    {validatorCount: 16 * validatorsPerEpoch, committeeCount: 16 * EPOCH_LENGTH},
    {validatorCount: 32 * validatorsPerEpoch, committeeCount: 16 * EPOCH_LENGTH},
  ];
  for (const {validatorCount, committeeCount} of tests) {
    assert.equal(getEpochCommitteeCount(validatorCount), committeeCount);
  }
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
    it(`Slot ${pair.test} should map to epoch ${pair.expected}`, () => {
      const result: EpochNumber = slotToEpoch(new BN(pair.test));
      assert(result.eq(new BN(pair.expected)));
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
    it(`Epoch ${pair.test} should map to slot ${pair.expected}`, () => {
      const result: SlotNumber = getEpochStartSlot(new BN(pair.test));
      assert(result.eq(new BN(pair.expected)));
    });
  }
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator(0, 100);
    const result: boolean = isActiveValidator(v, new BN(0));
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(10, 101);
    const result: boolean = isActiveValidator(v, new BN(100));
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(100, 1000);
    const result: boolean = isActiveValidator(v, new BN(100));
    assert.isTrue(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1);
    const result: boolean = isActiveValidator(v, new BN(0));
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(100);
    const result: boolean = isActiveValidator(v, new BN(5));
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1, 5);
    const result: boolean = isActiveValidator(v, new BN(100));
    assert.isFalse(result);
  });
});

describe("getForkVersion", () => {
  const fork: Fork = {
    epoch: new BN(12),
    previousVersion: new BN(4),
    currentVersion: new BN(5)
  };

  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("fork version should be 4", () => {
    const result = getForkVersion(fork, new BN(8));
    assert(result.eq(four));
  });

  it("fork version should be 5", () => {
    const result = getForkVersion(fork, new BN(13));
    assert(result.eq(five));
  });

  it("fork version should be 5", () => {
    const result = getForkVersion(fork, new BN(12));
    assert(result.eq(five));
  });
});

describe("getDomain", () => {
  const fork: Fork = {
    epoch: new BN(12),
    previousVersion: new BN(4),
    currentVersion: new BN(5)
  };

  const constant: uint64 = new BN(2 ** 32);
  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("domain version should be 4", () => {
    const result = getDomain(fork, new BN(8),4);
    const expected = four.mul(constant).add(four);
    assert(result.eq(expected));
  });

  it("domain version should be 5", () => {
    const result = getDomain(fork, new BN(13),5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });

  it("domain version should be 5", () => {
    const result = getDomain(fork, new BN(12),5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });
});
