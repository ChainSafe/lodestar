import crypto from "node:crypto";
import {describe, expect, it} from "vitest";
import {digest} from "@chainsafe/as-sha256";
import {toHexString} from "@chainsafe/ssz";
import {DOMAIN_PTC_ATTESTER, ForkSeq, GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {bytesToInt} from "@lodestar/utils";
import {generateState} from "../../../src/testUtils/state.js";
import {
  computeEpochShuffling,
  computePayloadTimelinessCommitteeForSlot,
  computePayloadTimelinessCommitteeIndices,
  computePayloadTimelinessCommitteesForEpoch,
  computeProposerIndex,
  getNextSyncCommitteeIndices,
  getRandaoMix,
  getSeed,
  naiveComputePayloadTimelinessCommitteeIndices,
  naiveComputeProposerIndex,
  naiveGetNextSyncCommitteeIndices,
} from "../../../src/util/index.js";
import {generateValidators} from "../../utils/validator.js";

describe("getRandaoMix", () => {
  const randaoMix1 = Buffer.alloc(32, 1);
  const randaoMix2 = Buffer.alloc(32, 2);

  it("should return first randao mix for GENESIS_EPOCH", () => {
    // Empty state in 2nd epoch
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_EPOCH});
    state.randaoMixes.set(0, randaoMix1);

    const res = getRandaoMix(state, GENESIS_EPOCH);
    expect(toHexString(res)).toBe(toHexString(randaoMix1));
  });
  it("should return second randao mix for GENESIS_EPOCH + 1", () => {
    // Empty state in 2nd epoch
    const state = generateState({slot: GENESIS_SLOT + SLOTS_PER_EPOCH * 2});
    state.randaoMixes.set(0, randaoMix1);
    state.randaoMixes.set(1, randaoMix2);

    const res = getRandaoMix(state, GENESIS_EPOCH + 1);
    expect(toHexString(res)).toBe(toHexString(randaoMix2));
  });
});

describe("computeProposerIndex", () => {
  const seed = crypto.randomBytes(32);
  const vc = 1000;
  const activeIndices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }

  for (const fork of [ForkSeq.phase0, ForkSeq.electra]) {
    it(`should be the same to the naive version - ${ForkSeq[fork]}`, () => {
      const expected = naiveComputeProposerIndex(fork, effectiveBalanceIncrements, activeIndices, seed);
      const result = computeProposerIndex(fork, effectiveBalanceIncrements, activeIndices, seed);
      expect(result).toBe(expected);
    });
  }
});

describe("electra getNextSyncCommitteeIndices", () => {
  const vc = 1000;
  const validators = generateValidators(vc);
  const state = generateState({validators});
  const activeValidatorIndices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }

  for (const fork of [ForkSeq.phase0, ForkSeq.electra]) {
    it(`should be the same to the naive version - ${ForkSeq[fork]}`, () => {
      const expected = naiveGetNextSyncCommitteeIndices(
        fork,
        state,
        activeValidatorIndices,
        effectiveBalanceIncrements
      );
      const result = getNextSyncCommitteeIndices(fork, state, activeValidatorIndices, effectiveBalanceIncrements);
      expect(result).toEqual(new Uint32Array(expected));
    });
  }
});

describe("computePayloadTimelinessCommitteeIndices", () => {
  const seed = crypto.randomBytes(32);
  const vc = 1000;
  const indices = new Uint32Array(Array.from({length: vc}, (_, i) => i));
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }

  it("should be the same to the naive version", () => {
    const expected = naiveComputePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, indices, seed);
    const result = computePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, indices, seed);
    expect(result).toEqual(new Uint32Array(expected));
  });

  it("should compute an epoch with the same per-slot results", () => {
    const epochValidatorCount = 16_384;
    const epochIndices = Uint32Array.from({length: epochValidatorCount}, (_, i) => i);
    const epochEffectiveBalanceIncrements = new Uint16Array(epochValidatorCount).fill(32);
    const state = generateState();
    const epoch = 0;
    const shuffling = computeEpochShuffling(state, epochIndices, epoch);
    const epochSeed = getSeed(state, epoch, DOMAIN_PTC_ATTESTER);
    const slotSeedInput = new Uint8Array(epochSeed.length + 8);
    slotSeedInput.set(epochSeed);
    const slotSeedView = new DataView(slotSeedInput.buffer);
    const expected = new Array<Uint32Array>(SLOTS_PER_EPOCH);
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      slotSeedView.setUint32(epochSeed.length, i, true);
      slotSeedView.setUint32(epochSeed.length + 4, 0, true);
      expected[i] = computePayloadTimelinessCommitteeForSlot(
        digest(slotSeedInput),
        shuffling.committees[i],
        epochEffectiveBalanceIncrements
      );
    }

    expect(
      computePayloadTimelinessCommitteesForEpoch(
        state,
        epoch,
        shuffling.committees,
        epochEffectiveBalanceIncrements,
        shuffling.shuffling
      )
    ).toEqual(expected);
    expect(
      computePayloadTimelinessCommitteesForEpoch(state, epoch, shuffling.committees, epochEffectiveBalanceIncrements)
    ).toEqual(expected);
  });
});

describe("number from 2 bytes bytesToInt", () => {
  it("should compute numbers manually from 2 bytes", () => {
    // this is to be used in getNextSyncCommitteeIndices without getting through BigInt
    for (let lowByte = 0; lowByte < 256; lowByte++) {
      for (let highByte = 0; highByte < 256; highByte++) {
        const bytes = new Uint8Array([lowByte, highByte]);
        const n = lowByte + highByte * 256;
        expect(n).toBe(bytesToInt(bytes));
      }
    }
  });
});
