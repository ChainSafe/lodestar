import BN from "bn.js";
import { assert } from "chai";

import {
  GENESIS_EPOCH,
  GENESIS_SLOT,
  LATEST_BLOCK_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "../../../src/constants";
import {
  getActiveValidatorIndices,
  getBitfieldBit,
  getBlockRoot,
  getDomain,
  getEpochCommitteeCount,
  getEpochStartSlot,
  getForkVersion, getRandaoMix,
  hash,
  intToBytes,
  getPreviousEpoch,
  getTotalBalance,
  intSqrt,
  isActiveValidator,
  isDoubleVote,
  isPowerOfTwo,
  isSurroundVote,
  merkleRoot,
  slotToEpoch,
  split,
} from "../../../src/chain/helpers/stateTransitionHelpers";
import {BeaconState, Epoch, Fork, int, Slot, uint64, Validator, ValidatorIndex} from "../../../src/types";
import {generateAttestationData} from "../../utils/attestation";
import {randBetween} from "../../utils/misc";
import {generateValidator, generateValidators} from "../../utils/validator";
import {generateState} from "../../utils/state";
import {setInterval} from "timers";

describe("intToBytes", () => {
  const zeroedArray = (length) => Array.from({length}, () => 0);
  const testCases: any = [
    {input: [255, 1], output: Buffer.from([255])},
    {input: [new BN(255), 1], output: Buffer.from([255])},
    {input: [65535, 2], output: Buffer.from([255, 255])},
    {input: [new BN(65535), 2], output: Buffer.from([255, 255])},
    {input: [16777215, 3], output: Buffer.from([255, 255, 255])},
    {input: [new BN(16777215), 3], output: Buffer.from([255, 255, 255])},
    {input: [4294967295, 4], output: Buffer.from([255, 255, 255, 255])},
    {input: [new BN(4294967295), 4], output: Buffer.from([255, 255, 255, 255])},
    {input: [65535, 8], output: Buffer.from([255, 255, ...zeroedArray(8-2)])},
    {input: [new BN(65535), 8], output: Buffer.from([255, 255, ...zeroedArray(8-2)])},
    {input: [65535, 32], output: Buffer.from([255, 255, ...zeroedArray(32-2)])},
    {input: [new BN(65535), 32], output: Buffer.from([255, 255, ...zeroedArray(32-2)])},
    {input: [65535, 48], output: Buffer.from([255, 255, ...zeroedArray(48-2)])},
    {input: [new BN(65535), 48], output: Buffer.from([255, 255, ...zeroedArray(48-2)])},
    {input: [65535, 96], output: Buffer.from([255, 255, ...zeroedArray(96-2)])},
    {input: [new BN(65535), 96], output: Buffer.from([255, 255, ...zeroedArray(96-2)])},
  ];
  for (const {input, output} of testCases) {
    const type = BN.isBN(input[0]) ? 'BN' : 'number';
    const length = input[1];
    it(`should correctly serialize ${type} to bytes length ${length}`, () => {
      assert(intToBytes(input[0], input[1]).equals(output));
    });
  }
});

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
    for (let i = 2; i < 32; i++) {
      const powOfTwo = 2 ** i;
      const result = isPowerOfTwo(powOfTwo);
      assert.equal(result, true, "Should have returned true!");
      const result1 = isPowerOfTwo(powOfTwo - 1);
      assert.equal(result1, false, "Should have returned false!");
      const result2 = isPowerOfTwo(powOfTwo + 1);
      assert.equal(result2, false, "Should have returned false!");
    }
  });

  it("Should throw if a negative number is passed in", () => {
    assert.throws(() => { isPowerOfTwo(-1); });
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
    const epoch: Epoch = randBetween(1, 1000);
    const slot1: Slot = epoch * SLOTS_PER_EPOCH;
    const slot2: Slot = slot1 + SLOTS_PER_EPOCH - 1;
    const a1 = generateAttestationData(slot1, randBetween(1, 1000));
    const a2 = generateAttestationData(slot2, randBetween(1, 1000));
    assert.isTrue(isDoubleVote(a1, a2));
  });

  it("Attestation data with different epochs should return false", () => {
    const epoch: Epoch = randBetween(1, 1000);
    const slot1: Slot = epoch * SLOTS_PER_EPOCH;
    const slot2: Slot = slot1 - 1;
    const a1 = generateAttestationData(slot1, randBetween(1, 1000));
    const a2 = generateAttestationData(slot2, randBetween(1, 1000));
    assert.isFalse(isDoubleVote(a1, a2));
  });
});

describe("isSurroundVote", () => {
  it("Attestation data with the same epoch should return true", () => {
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    const sourceEpoch2: Epoch = sourceEpoch1 + 1;

    const targetEpoch1: Epoch = randBetween(1, 1000);
    const targetEpoch2: Epoch = targetEpoch1 - 1;

    const targetSlot1: Slot = targetEpoch1 * SLOTS_PER_EPOCH;
    const targetSlot2: Slot = targetEpoch2 * SLOTS_PER_EPOCH;

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    const a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isTrue(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a greater source epoch", () => {
    // Both attestations have the same source epoch.
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    let sourceEpoch2: Epoch = sourceEpoch1;

    const targetEpoch1: Epoch = randBetween(1, 1000);
    const targetEpoch2: Epoch = targetEpoch1 - 1;

    const targetSlot1: Slot = targetEpoch1 * SLOTS_PER_EPOCH;
    const targetSlot2: Slot = targetEpoch2 * SLOTS_PER_EPOCH;

    const a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a smaller source epoch.
    sourceEpoch2 = sourceEpoch1 - 1;
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
  });

  it("Should return false if the second attestation does not have a smaller target epoch", () => {
    // Both attestations have the same target epoch.
    const sourceEpoch1: Epoch = randBetween(1, 1000);
    const sourceEpoch2: Epoch = sourceEpoch1 + 1;

    const targetEpoch: Epoch = randBetween(2, 1000);

    // Last slot in the epoch.
    let targetSlot1: Slot = targetEpoch * SLOTS_PER_EPOCH - 1;
    // First slot in the epoch
    let targetSlot2: Slot = (targetEpoch - 1) * SLOTS_PER_EPOCH;

    let a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    let a2 = generateAttestationData(targetSlot2, sourceEpoch2);

    assert.isFalse(isSurroundVote(a1, a2));

    // Second attestation has a greater target epoch.
    targetSlot1 = targetEpoch * SLOTS_PER_EPOCH;
    targetSlot2 = (targetEpoch + 1) * SLOTS_PER_EPOCH;
    a1 = generateAttestationData(targetSlot1, sourceEpoch1);
    a2 = generateAttestationData(targetSlot2, sourceEpoch2);
    assert.isFalse(isSurroundVote(a1, a2));
  });
});

describe("getActiveValidatorIndices", () => {
  const vrArray: Validator[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(generateValidator);

  it("empty list of Validators should return no indices (empty list)", () => {
    assert.deepEqual(getActiveValidatorIndices([], randBetween(0, 4)), []);
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

// describe("getShuffling", () => {
//   const seed = Buffer.alloc(65);
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
      const result: Epoch = slotToEpoch(pair.test);
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
    it(`Epoch ${pair.test} should map to slot ${pair.expected}`, () => {
      const result: Slot = getEpochStartSlot(pair.test);
      assert.equal(result, pair.expected);
    });
  }
});

describe("isActiveValidator", () => {
  it("should be active", () => {
    const v: Validator = generateValidator(0, 100);
    const result: boolean = isActiveValidator(v, 0);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(10, 101);
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should be active", () => {
    const v: Validator = generateValidator(100, 1000);
    const result: boolean = isActiveValidator(v, 100);
    assert.isTrue(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1);
    const result: boolean = isActiveValidator(v, 0);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(100);
    const result: boolean = isActiveValidator(v, 5);
    assert.isFalse(result);
  });

  it("should not be active", () => {
    const v: Validator = generateValidator(1, 5);
    const result: boolean = isActiveValidator(v, 100);
    assert.isFalse(result);
  });
});

describe("getForkVersion", () => {
  const fork: Fork = {
    epoch: 12,
    previousVersion: new BN(4),
    currentVersion: new BN(5),
  };

  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, 8);
    assert(result.eq(four));
  });

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, 13);
    assert(result.eq(five));
  });

  it("epoch after fork epoch returns current fork version", () => {
    const result = getForkVersion(fork, 12);
    assert(result.eq(five));
  });
});

describe("getDomain", () => {
  const fork: Fork = {
    epoch: 12,
    previousVersion: new BN(4),
    currentVersion: new BN(5),
  };

  const constant: uint64 = new BN(2 ** 32);
  const four: uint64 = new BN(4);
  const five: uint64 = new BN(5);

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, 8, 4);
    const expected = four.mul(constant).add(four);
    assert(result.eq(expected));
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, 13, 5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });

  it("epoch before fork epoch should result in domain === previous fork version * 2**32 + domain type", () => {
    const result = getDomain(fork, 12, 5);
    const expected = five.mul(constant).add(five);
    assert(result.eq(expected));
  });
});

describe("getBitfieldBit", () => {
  it("should return 1 for the 4th (index 3) bit of [0x8]", () => {
    const result = getBitfieldBit(Buffer.from([0x8]), 3);
    assert(result === 1, `returned ${result} not 1`);
  });
  it("should return 0 for the 3rd (index 2) bit of [0x8]", () => {
    const result = getBitfieldBit(Buffer.from([0x8]), 2);
    assert(result === 0, `returned ${result} not 0`);
  });
  it("should return 1 for the 18th (index 17) bit of [0x8, 0x4, 0x2, 0x1]", () => {
    const result = getBitfieldBit(Buffer.from([0x8, 0x4, 0x2, 0x1]), 17);
    assert(result === 1, `returned ${result} not 1`);
  });
  it("should return 1 for the 19th (index 18) bit of [0x8, 0x4, 0x2, 0x1]", () => {
    const result = getBitfieldBit(Buffer.from([0x8, 0x4, 0x2, 0x1]), 18);
    assert(result === 0, `returned ${result} not 0`);
  });
})

describe("merkleRoot", () => {
  it("Merkle root and computed merkle root should be equal", () => {
    const testValue = [
      Buffer.from('a'),
      Buffer.from('b'),
      Buffer.from('c'),
      Buffer.from('d'),
    ];
    const computedRoot = merkleRoot(testValue);

    // leaf nodes
    const hashV1 = Buffer.from('a');
    const hashV2 = Buffer.from('b');
    const hashV3 = Buffer.from('c');
    const hashV4 = Buffer.from('d');

    // hash intermediate nodes
    const leftNode = hash(Buffer.concat([hashV1, hashV2]));
    const rightNode = hash(Buffer.concat([hashV3, hashV4]));
    // hash root node
    const expectedRoot = hash(Buffer.concat([leftNode, rightNode]));

    assert(expectedRoot.equals(computedRoot), `${expectedRoot} didn't equal ${computedRoot}`);
  });
});

describe("getPreviousEpoch", () => {

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({ slot: 512});
    const expected: Epoch = 7;
    const result = getPreviousEpoch(state);
    assert.equal(result, expected);
  });

  it("epoch should return previous epoch", () => {
    const state: BeaconState = generateState({ slot: 256});
    const expected: Epoch = 3;
    const result = getPreviousEpoch(state);
    assert.equal(result, expected);
  });

  it("epoch should return genesis epoch", () => {
    const state: BeaconState = generateState({ slot: GENESIS_SLOT});
    const expected: Epoch = slotToEpoch(GENESIS_SLOT);
      const result = getPreviousEpoch(state);
    assert.equal(result, expected);
  });
});

describe("getTotalBalance", () => {

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num);
    const balances: uint64[] = Array.from({length: num}, () => new BN(500));
    const state: BeaconState = generateState({ validatorRegistry: validators, validatorBalances: balances });
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(num).muln(500);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });

  it("should return correct balances", () => {
    const num = 5;
    const validators: Validator[] = generateValidators(num);
    const balances: uint64[] = Array.from({length: num}, () => new BN(0));
    const state: BeaconState = generateState({ validatorRegistry: validators, validatorBalances: balances });
    const validatorIndices: ValidatorIndex[] = Array.from({length: num}, (_, i) => i);

    const result = getTotalBalance(state, validatorIndices);
    const expected = new BN(num).muln(0);
    assert(result.eq(expected), `Expected: ${expected} :: Result: ${result}`);
  });
});


describe("intToBytes", () => {
  it("should convert number 0 to an empty buffer", () => {
    const res = intToBytes(0, 1)
    assert(res.equals(Uint8Array.from([0])), `got: ${res}, expected:${[0]}`)
  });
  it("should convert BigNumber 0 to an empty buffer", () => {
    const res = intToBytes(new BN(0), 1)
    assert(res.equals(Uint8Array.from([0])), `got: ${res}, expected:${[0]}`)
  });
  it("should convert number 1 to a single byte 0b00000001", () => {
    const res = intToBytes(1, 1)
    assert(res.equals(Uint8Array.from([1])), `got: ${res}, expected:${[1]}`)
  });
  it("should convert BigNumber 1 to a single byte 0b00000001", () => {
    const res = intToBytes(new BN(1), 1)
    assert(res.equals(Uint8Array.from([1])), `got: ${res}, expected:${[1]}`)
  });
  it("should convert number 16704 to two bytes [0x40, 0x42]", () => {
    const res = intToBytes(16704, 2)
    assert(res.equals(Uint8Array.from([0x40, 0x41])), `got: ${res}, expected:${[0x40, 0x41]}`)
  });
  it("should convert BigNumber 16704 to two bytes [0x40, 0x42]", () => {
    const res = intToBytes(new BN(16704), 2)
    assert(res.equals(Uint8Array.from([0x40, 0x41])), `got: ${res}, expected:${[0x40, 0x41]}`)
  });
});


describe("getRandaoMix", () => {
  it("should return first randao mix for GENESIS_EPOCH", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    })
    const res = getRandaoMix(state, GENESIS_EPOCH)
    assert(res.equals(Uint8Array.from([0xAB])))
  })
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH * 2,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD]), Buffer.from([0xEF])]
    })
    const res = getRandaoMix(state, GENESIS_EPOCH + 1)
    assert(res.equals(Uint8Array.from([0xCD])))
  })
  it("should fail to get randao mix for epoch more than LATEST_RANDAO_MIXES_LENGTH in the past", () => {
    // Empty state in epoch LATEST_RANDAO_MIXES_LENGTH with incrementing randao mixes
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH * LATEST_RANDAO_MIXES_LENGTH,
      latestRandaoMixes: Array.from({length: LATEST_RANDAO_MIXES_LENGTH}, (e, i) => Buffer.from([i]))
    })
    assert.throws(() => getRandaoMix(state, GENESIS_EPOCH), "")
  })
  it("should fail to get randao mix for epoch > current epoch", () => {
    // Empty state in second epoch (genesis + 1)
    const state = generateState({
      slot: GENESIS_SLOT + SLOTS_PER_EPOCH,
      latestRandaoMixes: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    })
    assert.throws(() => getRandaoMix(state, GENESIS_EPOCH + 1), "")
  })
})

describe("getBlockRoot", () => {
  it("should return first block root for genesis slot", () => {
    const state = generateState({
      slot:  GENESIS_SLOT + 1,
      latestBlockRoots: [Buffer.from([0xAB])]
    })
    const res = getBlockRoot(state, GENESIS_SLOT)
    assert((new BN(res)).eq(new BN(0xAB)),
      `got: ${new BN(res)}, expected: ${0xAB}`)
  })
  it("should return second block root for genesis + 1 slot", () => {
    const state = generateState({
      slot:  GENESIS_SLOT + 2,
      latestBlockRoots: [Buffer.from([0xAB]), Buffer.from([0xCD])]
    })
    const res = getBlockRoot(state, GENESIS_SLOT + 1)
    assert((new BN(res)).eq(new BN(0xCD)),
      `got: ${new BN(res)}, expected: ${0xAB}`)
  })
  it("should fail if slot is current slot", () => {
    const state = generateState({slot: GENESIS_SLOT})
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "")
  })
  it("should fail if slot is not within LATEST_BLOCK_ROOTS_LENGTH of current slot", () => {
    const state = generateState({slot: GENESIS_SLOT + LATEST_BLOCK_ROOTS_LENGTH + 1})
    assert.throws(() => getBlockRoot(state, GENESIS_SLOT), "")
  })
})
