import crypto from "node:crypto";
import {describe, expect, it} from "vitest";

import {toHexString} from "@chainsafe/ssz";
import {ForkSeq, GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  computeProposerIndex,
  computeShuffledIndex,
  getComputeShuffledIndexFn,
  getNextSyncCommitteeIndices,
  getRandaoMix,
  naiveComputeProposerIndex,
  naiveGetNextSyncCommitteeIndices,
} from "../../../src/util/index.js";

import {bytesToInt} from "@lodestar/utils";
import {generateState} from "../../utils/state.js";
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

describe("computeProposerIndex electra", () => {
  const seed = crypto.randomBytes(32);
  const vc = 1000;
  const activeIndices = Array.from({length: vc}, (_, i) => i);
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }

  it("should be the same to the naive version", () => {
    const expected = naiveComputeProposerIndex(ForkSeq.electra, effectiveBalanceIncrements, activeIndices, seed);
    const result = computeProposerIndex(ForkSeq.electra, effectiveBalanceIncrements, activeIndices, seed);
    expect(result).toBe(expected);
  });
});

describe("computeShuffledIndex", () => {
  const seed = crypto.randomBytes(32);
  const vc = 1000;
  const shuffledIndexFn = getComputeShuffledIndexFn(vc, seed);
  it("should be the same to the naive version", () => {
    for (let i = 0; i < vc; i++) {
      const expectedIndex = computeShuffledIndex(i, vc, seed);
      expect(shuffledIndexFn(i)).toBe(expectedIndex);
    }
  });
});

describe("electra getNextSyncCommitteeIndices", () => {
  const vc = 1000;
  const validators = generateValidators(vc);
  const state = generateState({validators});
  const activeValidatorIndices = Array.from({length: vc}, (_, i) => i);
  const effectiveBalanceIncrements = new Uint16Array(vc);
  for (let i = 0; i < vc; i++) {
    effectiveBalanceIncrements[i] = 32 + 32 * (i % 64);
  }

  it("should return the same result as naiveGetNextSyncCommitteeIndices", () => {
    const expected = naiveGetNextSyncCommitteeIndices(
      ForkSeq.electra,
      state,
      activeValidatorIndices,
      effectiveBalanceIncrements
    );
    const result = getNextSyncCommitteeIndices(
      ForkSeq.electra,
      state,
      activeValidatorIndices,
      effectiveBalanceIncrements
    );
    expect(result).toEqual(expected);
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
