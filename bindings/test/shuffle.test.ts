import {randomBytes} from "node:crypto";
import {describe, expect, it} from "vitest";
import * as shuffle from "../src/shuffle.js";
import * as shuffleReference from "./shuffleReference.js";

const innerShuffleList = shuffle.innerShuffleList;
const SEED_SIZE = 32;

describe("innerShuffleList", () => {
  it("should shuffle forwards and backwards correctly", async () => {
    const input = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const seed = new Uint8Array(SEED_SIZE).fill(0);
    const rounds = 32;
    const forwards = false;

    innerShuffleList(input, seed, rounds, forwards);
    expect(input.length).toEqual(input.length);
    var expected = new Uint32Array([6, 2, 3, 5, 1, 7, 8, 0, 4]);
    expect(input).toEqual(expected);

    // shuffle back
    const backwards = true;
    innerShuffleList(input, seed, rounds, backwards);
    expected = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(input).toEqual(expected);
  });

  it("should do nothing", async () => {
    const testCases = [
      {expected: new Uint32Array([]), input: new Uint32Array([]), rounds: 3}, // list length = 0
      {expected: new Uint32Array([0, 1, 2, 3, 4]), input: new Uint32Array([0, 1, 2, 3, 4]), rounds: 0}, // rounds = 0
    ];
    const seed = new Uint8Array(SEED_SIZE).fill(0);
    const forwards = false;
    for (const testCase of testCases) {
      innerShuffleList(testCase.input, seed, testCase.rounds, forwards);
      expect(testCase.input).toEqual(testCase.expected);
    }
  });

  it("should fail with invalid input type", async () => {
    const invalidInput = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const seed = new Uint8Array(SEED_SIZE).fill(0);
    const rounds = 32;
    const forwards = false;
    expect(() => {
      innerShuffleList(invalidInput as any, seed, rounds, forwards);
    }).toThrow("Argument 1 must be a Uint32Array");
  });

  it("should fail with invalid rounds", async () => {
    const validInput = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const seed = new Uint8Array(SEED_SIZE).fill(0);
    const invalidNumRounds = [-1, 256];
    const forwards = false;

    for (const r of invalidNumRounds) {
      expect(() => {
        innerShuffleList(validInput, seed, r, forwards);
      }).toThrow("InvalidRoundsSize");
    }
  });
});

// Ported from https://github.com/ChainSafe/swap-or-not-shuffle/tree/main/test/unit

interface ShuffleTestCase {
  id: string;
  rounds: number;
  seed: Uint8Array;
  input: Uint32Array;
  unshuffled: string;
}

function fromHex(hex: string): Uint8Array {
  const b = Buffer.from(hex.startsWith("0x") ? hex.slice(2) : hex, "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}

function getInputArray(count: number): Uint32Array {
  return Uint32Array.from(Array.from({length: count}, (_, i) => i));
}

function toHex(arr: Uint32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("hex");
}

function buildReferenceTestCase(count: number, rounds: number): ShuffleTestCase {
  const seed = new Uint8Array(randomBytes(32));
  const input = getInputArray(count);
  const unshuffled = input.slice();
  shuffleReference.unshuffleList(unshuffled, seed, rounds);
  return {
    id: `TestCase for ${count} indices with seed of 0x${Buffer.from(seed).toString("hex")}`,
    input,
    rounds,
    seed,
    unshuffled: toHex(unshuffled),
  };
}

describe("shuffle", () => {
  it("should throw for invalid seed", () => {
    const test = buildReferenceTestCase(10, 10);
    let invalidSeed = Buffer.alloc(31, 0xac);
    expect(() => shuffle.unshuffleList(test.input, invalidSeed, test.rounds)).to.throw("InvalidSeedLength");
    invalidSeed = Buffer.alloc(33, 0xac);
    expect(() => shuffle.unshuffleList(test.input, invalidSeed, test.rounds)).to.throw("InvalidSeedLength");
  });

  it("should throw for invalid number of rounds", () => {
    const test = buildReferenceTestCase(10, 10);
    expect(() => shuffle.unshuffleList(test.input, test.seed, -1)).to.throw("InvalidNumberOfRounds");
    expect(() => shuffle.unshuffleList(test.input, test.seed, 256)).to.throw("InvalidNumberOfRounds");
  });

  it("should skip validation for empty and single-element lists (reference validation order)", () => {
    const invalidSeed = Buffer.alloc(31, 0xac);
    expect(Array.from(shuffle.unshuffleList(new Uint32Array([]), invalidSeed, 10))).toEqual([]);
    expect(Array.from(shuffle.unshuffleList(new Uint32Array([7]), invalidSeed, -1))).toEqual([7]);
    // rounds == 0 returns before any validation
    expect(Array.from(shuffle.unshuffleList(new Uint32Array([0, 1, 2]), invalidSeed, 0))).toEqual([0, 1, 2]);
  });

  it("should not mutate the input array", () => {
    const seed = new Uint8Array(randomBytes(32));
    const input = getInputArray(100);
    shuffle.unshuffleList(input, seed, 90);
    expect(Array.from(input)).toEqual(Array.from(getInputArray(100)));
  });

  it("should round-trip via innerShuffleList", () => {
    const {seed} = buildReferenceTestCase(1, 1);
    const original = getInputArray(100);
    const roundTripped = original.slice();
    innerShuffleList(roundTripped, seed, 90, false);
    expect(Array.from(roundTripped)).not.toEqual(Array.from(original));
    innerShuffleList(roundTripped, seed, 90, true);
    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });

  it("should match spec test results", () => {
    const seed = "0x4fe91d85d6bc19b20413659c61f3c690a1c4d48be41cab8363a130cebabada97";
    const rounds = 10;
    const expected = [
      99, 71, 51, 5, 78, 61, 12, 17, 30, 3, 59, 47, 6, 9, 1, 41, 18, 37, 55, 43, 20, 31, 38, 79, 29, 69, 70, 54, 53, 36,
      34, 62, 77, 87, 39, 96, 56, 92, 16, 82, 40, 27, 58, 14, 68, 76, 80, 13, 28, 81, 64, 26, 19, 60, 90, 2, 98, 67, 66,
      52, 46, 95, 49, 72, 8, 21, 75, 57, 97, 83, 84, 88, 86, 7, 74, 32, 63, 85, 23, 65, 24, 91, 0, 48, 35, 15, 44, 25,
      22, 73, 93, 45, 4, 33, 89, 94, 10, 42, 11, 50,
    ];

    const result = shuffle.unshuffleList(getInputArray(100), fromHex(seed), rounds);
    expect(Array.from(result)).toEqual(expected);
  });

  const testCases: ShuffleTestCase[] = [
    buildReferenceTestCase(8, 10),
    buildReferenceTestCase(16, 10),
    buildReferenceTestCase(16, 100),
    buildReferenceTestCase(256, 192),
    buildReferenceTestCase(256, 192),
    buildReferenceTestCase(1000, 90),
  ];

  for (const {id, seed, rounds, input, unshuffled} of testCases) {
    it(`${id}`, () => {
      expect(toHex(shuffle.unshuffleList(input, seed, rounds))).to.equal(unshuffled);
    });
  }
});

describe("committee indices", () => {
  const vc = 1000;
  const activeIndices = getInputArray(vc);
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }
  const {
    EFFECTIVE_BALANCE_INCREMENT,
    MAX_EFFECTIVE_BALANCE,
    MAX_EFFECTIVE_BALANCE_ELECTRA,
    SYNC_COMMITTEE_SIZE,
    SHUFFLE_ROUND_COUNT,
  } = shuffleReference;
  const byteCounts = [1, 2] as const;
  const maxEffectiveBalanceFor = (byteCount: number) =>
    byteCount === 1 ? MAX_EFFECTIVE_BALANCE : MAX_EFFECTIVE_BALANCE_ELECTRA;

  it("computeProposerIndex should match the naive implementation", () => {
    for (const byteCount of byteCounts) {
      const seed = new Uint8Array(randomBytes(32));
      expect(
        shuffle.computeProposerIndex(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          byteCount,
          maxEffectiveBalanceFor(byteCount),
          EFFECTIVE_BALANCE_INCREMENT,
          SHUFFLE_ROUND_COUNT
        ),
        `byteCount ${byteCount}, seed 0x${Buffer.from(seed).toString("hex")}`
      ).toEqual(
        shuffleReference.naiveComputeProposerIndex(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          byteCount,
          maxEffectiveBalanceFor(byteCount)
        )
      );
    }
  });

  it("computeSyncCommitteeIndices should match the naive implementation", {timeout: 20_000}, () => {
    const seed = new Uint8Array(SEED_SIZE).fill(0x5a);
    for (const byteCount of byteCounts) {
      const expected = shuffleReference.naiveComputeSyncCommitteeIndices(
        seed,
        activeIndices,
        effectiveBalanceIncrements,
        byteCount,
        maxEffectiveBalanceFor(byteCount)
      );
      for (const size of [32, SYNC_COMMITTEE_SIZE]) {
        const result = shuffle.computeSyncCommitteeIndices(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          byteCount,
          size,
          maxEffectiveBalanceFor(byteCount),
          EFFECTIVE_BALANCE_INCREMENT,
          SHUFFLE_ROUND_COUNT
        );
        expect(Array.from(result), `byteCount ${byteCount}, size ${size}`).toEqual(expected.slice(0, size));
      }
    }
  });
});

describe("ptc indices", () => {
  const vc = 1000;
  const activeIndices = getInputArray(vc);
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }
  const {EFFECTIVE_BALANCE_INCREMENT, MAX_EFFECTIVE_BALANCE_ELECTRA, PTC_SIZE, SLOTS_PER_EPOCH} = shuffleReference;

  it("computePtcIndices should match the naive implementation", () => {
    const seed = new Uint8Array(randomBytes(32));
    expect(
      Array.from(
        shuffle.computePtcIndices(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        )
      ),
      `seed 0x${Buffer.from(seed).toString("hex")}`
    ).toEqual(
      shuffleReference.naiveComputePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, activeIndices, seed)
    );
  });

  it("computePtcIndicesForEpoch should match the naive implementation", {timeout: 10_000}, () => {
    const epochSeed = new Uint8Array(randomBytes(32));
    const startSlot = 12345;
    const indicesPerSlot = Math.floor(vc / SLOTS_PER_EPOCH);
    const slotOffsets = new Uint32Array(SLOTS_PER_EPOCH + 1);
    for (let i = 0; i <= SLOTS_PER_EPOCH; i++) slotOffsets[i] = i * indicesPerSlot;

    const committees: Uint32Array[][] = new Array(SLOTS_PER_EPOCH);
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      committees[i] = [activeIndices.subarray(slotOffsets[i], slotOffsets[i + 1])];
    }

    expect(
      Array.from(
        shuffle.computePtcIndicesForEpoch(
          epochSeed,
          startSlot,
          SLOTS_PER_EPOCH,
          activeIndices,
          slotOffsets,
          effectiveBalanceIncrements,
          PTC_SIZE,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        )
      ),
      `epochSeed 0x${Buffer.from(epochSeed).toString("hex")}`
    ).toEqual(
      shuffleReference
        .naiveComputePayloadTimelinessCommitteesForEpoch(epochSeed, startSlot, committees, effectiveBalanceIncrements)
        .flat()
    );
  });

  it("should reject non-u32 sizes and slots instead of coercing", () => {
    const seed = new Uint8Array(32);
    for (const ptcSize of [-1, 1.5, 2 ** 32]) {
      expect(() =>
        shuffle.computePtcIndices(
          seed,
          activeIndices,
          effectiveBalanceIncrements,
          ptcSize,
          MAX_EFFECTIVE_BALANCE_ELECTRA,
          EFFECTIVE_BALANCE_INCREMENT
        )
      ).to.throw("InvalidUnsignedInteger");
    }
    expect(() =>
      shuffle.computePtcIndicesForEpoch(
        seed,
        2 ** 32,
        1,
        activeIndices,
        Uint32Array.from([0, activeIndices.length]),
        effectiveBalanceIncrements,
        4,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT
      )
    ).to.throw("InvalidUnsignedInteger");
  });

  it("the Into variants should fill a caller-provided array", () => {
    const seed = new Uint8Array(randomBytes(32));
    const expected = shuffle.computePtcIndices(
      seed,
      activeIndices,
      effectiveBalanceIncrements,
      PTC_SIZE,
      MAX_EFFECTIVE_BALANCE_ELECTRA,
      EFFECTIVE_BALANCE_INCREMENT
    );
    const out = new Uint32Array(PTC_SIZE);
    shuffle.computePtcIndicesInto(
      out,
      seed,
      activeIndices,
      effectiveBalanceIncrements,
      MAX_EFFECTIVE_BALANCE_ELECTRA,
      EFFECTIVE_BALANCE_INCREMENT
    );
    expect(Array.from(out)).toEqual(Array.from(expected));

    const indicesPerSlot = Math.floor(vc / SLOTS_PER_EPOCH);
    const slotOffsets = new Uint32Array(SLOTS_PER_EPOCH + 1);
    for (let i = 0; i <= SLOTS_PER_EPOCH; i++) slotOffsets[i] = i * indicesPerSlot;
    const ptcSize = 8;
    const expectedEpoch = shuffle.computePtcIndicesForEpoch(
      seed,
      0,
      SLOTS_PER_EPOCH,
      activeIndices,
      slotOffsets,
      effectiveBalanceIncrements,
      ptcSize,
      MAX_EFFECTIVE_BALANCE_ELECTRA,
      EFFECTIVE_BALANCE_INCREMENT
    );
    const epochOut = new Uint32Array(SLOTS_PER_EPOCH * ptcSize);
    shuffle.computePtcIndicesForEpochInto(
      epochOut,
      seed,
      0,
      SLOTS_PER_EPOCH,
      activeIndices,
      slotOffsets,
      effectiveBalanceIncrements,
      ptcSize,
      MAX_EFFECTIVE_BALANCE_ELECTRA,
      EFFECTIVE_BALANCE_INCREMENT
    );
    expect(Array.from(epochOut)).toEqual(Array.from(expectedEpoch));

    // a wrongly sized out array is rejected rather than partially filled
    expect(() =>
      shuffle.computePtcIndicesForEpochInto(
        new Uint32Array(SLOTS_PER_EPOCH * ptcSize - 1),
        seed,
        0,
        SLOTS_PER_EPOCH,
        activeIndices,
        slotOffsets,
        effectiveBalanceIncrements,
        ptcSize,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT
      )
    ).to.throw("InvalidOutputLength");
  });

  it("computePtcIndices should throw for invalid inputs", () => {
    const seed = new Uint8Array(32);
    expect(() =>
      shuffle.computePtcIndices(
        new Uint8Array(31),
        activeIndices,
        effectiveBalanceIncrements,
        PTC_SIZE,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT
      )
    ).to.throw("InvalidSeedLength");
    expect(() =>
      shuffle.computePtcIndices(
        seed,
        new Uint32Array([]),
        effectiveBalanceIncrements,
        PTC_SIZE,
        MAX_EFFECTIVE_BALANCE_ELECTRA,
        EFFECTIVE_BALANCE_INCREMENT
      )
    ).to.throw("EmptyActiveIndices");
  });
});
