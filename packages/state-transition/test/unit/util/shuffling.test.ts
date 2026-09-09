import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "../../../src/index.js";
import {generateState} from "../../../src/testUtils/state.js";
import {computeEpochShuffling} from "../../../src/util/epochShuffling.js";

describe("EpochShuffling", () => {
  it("should shuffle active indices into a permutation split into committees", () => {
    const numberOfValidators = 1000;
    const activeIndices = Uint32Array.from(Array.from({length: numberOfValidators}, (_, i) => i));
    const state = generateState();
    state.slot = 12345;
    state.validators = ssz.phase0.Validators.toViewDU(
      Array.from({length: numberOfValidators}, () => ({
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: Infinity,
        effectiveBalance: 32,
        pubkey: Buffer.alloc(48, 0xaa),
        slashed: false,
        withdrawableEpoch: Infinity,
        withdrawalCredentials: Buffer.alloc(8, 0x01),
      }))
    );
    const epoch = computeEpochAtSlot(state.slot);

    const shuffling = computeEpochShuffling(state, activeIndices, epoch);

    expect(shuffling.epoch).toBe(epoch);
    expect(shuffling.activeIndices).toBe(activeIndices);
    expect(Array.from(shuffling.shuffling).sort((a, b) => a - b)).toEqual(Array.from(activeIndices));
    expect(shuffling.committees.length).toBe(SLOTS_PER_EPOCH);
    const committeeSize = shuffling.committees.flat().reduce((sum, c) => sum + c.length, 0);
    expect(committeeSize).toBe(numberOfValidators);

    // deterministic for the same state and epoch
    expect(computeEpochShuffling(state, activeIndices, epoch)).toStrictEqual(shuffling);
  });
});
