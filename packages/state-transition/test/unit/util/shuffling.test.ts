import {describe, expect, it} from "vitest";
import {INCLUSION_LIST_COMMITTEE_SIZE} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "../../../src/index.js";
import {generateState} from "../../../src/testUtils/state.js";
import {computeEpochShuffling, computeEpochShufflingAsync} from "../../../src/util/epochShuffling.js";
import {computeInclusionListCommittee} from "../../../src/util/shuffling.js";

describe("EpochShuffling", () => {
  it("async and sync versions should be identical", async () => {
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

    const sync = computeEpochShuffling(state, activeIndices, epoch);
    const async = await computeEpochShufflingAsync(state, activeIndices, epoch);

    expect(sync).toStrictEqual(async);
  });
});

describe("computeInclusionListCommittee", () => {
  it("takes the first INCLUSION_LIST_COMMITTEE_SIZE indices when the slot has enough validators", () => {
    const committees = [Uint32Array.from(Array.from({length: 40}, (_, i) => i + 100))];

    expect(Array.from(computeInclusionListCommittee(committees))).toEqual(
      Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => i + 100)
    );
  });

  it("flattens across committees in order", () => {
    const committees = [Uint32Array.from([7, 8, 9]), Uint32Array.from([10, 11]), Uint32Array.from([12])];

    // 6 validators total, cycles to fill INCLUSION_LIST_COMMITTEE_SIZE
    const expected = Array.from({length: INCLUSION_LIST_COMMITTEE_SIZE}, (_, i) => [7, 8, 9, 10, 11, 12][i % 6]);
    expect(Array.from(computeInclusionListCommittee(committees))).toEqual(expected);
  });

  it("cycles when the slot has fewer validators than the committee size", () => {
    const committee = computeInclusionListCommittee([Uint32Array.from([3, 4])]);

    expect(committee).toHaveLength(INCLUSION_LIST_COMMITTEE_SIZE);
    for (let i = 0; i < INCLUSION_LIST_COMMITTEE_SIZE; i++) {
      expect(committee[i]).toBe(i % 2 === 0 ? 3 : 4);
    }
  });

  it("returns zeros when the slot has no validators", () => {
    const committee = computeInclusionListCommittee([]);

    expect(committee).toHaveLength(INCLUSION_LIST_COMMITTEE_SIZE);
    expect(Array.from(committee).every((index) => index === 0)).toBe(true);
  });
});
