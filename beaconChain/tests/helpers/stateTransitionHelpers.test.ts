import BN from "bn.js";
import { assert } from "chai";

import { SLOTS_PER_EPOCH, TARGET_COMMITTEE_SIZE } from "../../constants";
import {
  clamp, getActiveValidatorIndices, getCurrentEpoch, getDomain, getEpochCommitteeCount, getEpochStartSlot, getForkVersion,
  intSqrt, isActiveValidator, isDoubleVote, isPowerOfTwo, isSurroundVote, readUIntBE, slotToEpoch, split,
} from "../../helpers/stateTransitionHelpers";
import {Epoch, Fork, Slot, uint64, Validator} from "../../types";
import {generateAttestationData} from "../utils/attestation";
import {randBetween} from "../utils/misc";
import {generateValidator} from "../utils/validator";

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
    const epoch: uint64 = new BN(randBetween(1, 1000));
    const slot1: uint64 = epoch.muln(SLOTS_PER_EPOCH);
    const slot2: uint64 = slot1.addn(SLOTS_PER_EPOCH - 1);
    const a1 = generateAttestationData(slot1, new BN(randBetween(1, 1000)));
    const a2 = generateAttestationData(slot2, new BN(randBetween(1, 1000)));
    assert.isTrue(isDoubleVote(a1, a2));
  });

  it("Attestation data with different epochs should return false", () => {
    const epoch: uint64 = new BN(randBetween(1, 1000));
    const slot1: uint64  = epoch.muln(SLOTS_PER_EPOCH);
    const slot2: uint64  = slot1.subn(1);
    const a1 = generateAttestationData(slot1, new BN(randBetween(1, 1000)));
    const a2 = generateAttestationData(slot2, new BN(randBetween(1, 1000)));
    assert.isFalse(isDoubleVote(a1, a2));
  });
});

describe("isSurroundVote", () => {
  it("Attestation data with the same epoch should return true", () => {
    const sourceEpoch1: uint64 = new BN(randBetween(1, 1000));
    const sourceEpoch2: uint64 = sourceEpoch1.addn(1);

    const targetEpoch1: uint64 = new BN(randBetween(1, 1000));
    const targetEpoch2: uint64 = targetEpoch1.subn(1);

    const targetSlot1: uint64 = targetEpoch1.muln(SLOTS_PER_EPOCH);
    const targetSlot2: uint64 = targetEpoch2.muln(SLOTS_PER_EPOCH);

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    const a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isTrue(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1: uint64 = new BN(randBetween(1, 1000));
    let sourceEpoch2: uint64 = sourceEpoch1;

    const targetEpoch1: uint64 = new BN(randBetween(1, 1000));
    const targetEpoch2: uint64 = targetEpoch1.subn(1);

    const targetSlot1: uint64 = targetEpoch1.muln(SLOTS_PER_EPOCH);
    const targetSlot2: uint64 = targetEpoch2.muln(SLOTS_PER_EPOCH);

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a smaller source epoch.
    sourceEpoch2 = sourceEpoch1.subn(1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a smaller target epoch", () => {
    // Both attestations have the same target epoch.
    const sourceEpoch1: uint64 = new BN(randBetween(1, 1000));
    const sourceEpoch2: uint64 = sourceEpoch1.addn(1);

    const targetEpoch = new BN(randBetween(2, 1000));

    // Last slot in the epoch.
    let targetSlot1: uint64 = targetEpoch.muln(SLOTS_PER_EPOCH).subn(1);
    // First slot in the epoch
    let targetSlot2: uint64 = targetEpoch.subn(1).muln(SLOTS_PER_EPOCH);

    let a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch.muln(SLOTS_PER_EPOCH);
    targetSlot2 = targetEpoch.addn(1).muln(SLOTS_PER_EPOCH);
    a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
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
  const validatorsPerEpoch = SLOTS_PER_EPOCH * TARGET_COMMITTEE_SIZE;
  const tests = [
    {validatorCount: 0, committeeCount: SLOTS_PER_EPOCH},
    {validatorCount: 1000, committeeCount: SLOTS_PER_EPOCH},
    {validatorCount: 2 * validatorsPerEpoch, committeeCount: 2 * SLOTS_PER_EPOCH},
    {validatorCount: 5 * validatorsPerEpoch, committeeCount: 5 * SLOTS_PER_EPOCH},
    {validatorCount: 16 * validatorsPerEpoch, committeeCount: 16 * SLOTS_PER_EPOCH},
    {validatorCount: 32 * validatorsPerEpoch, committeeCount: 16 * SLOTS_PER_EPOCH},
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
      const result: Epoch = slotToEpoch(new BN(pair.test));
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
      const result: Slot = getEpochStartSlot(new BN(pair.test));
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
    currentVersion: new BN(5),
  };

  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, new BN(8));
    assert(result.eq(four));
  });

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, new BN(13));
    assert(result.eq(five));
  });

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, new BN(12));
    assert(result.eq(five));
  });
});

describe("getDomain", () => {
  const fork: Fork = {
    epoch: new BN(12),
    previousVersion: new BN(4),
    currentVersion: new BN(5),
  };

  const constant: uint64 = new BN(2 ** 32);
  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, new BN(8), 4);
    const expected = four.mul(constant).add(four);
    assert(result.eq(expected));
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, new BN(13), 5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, new BN(12), 5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });
});
