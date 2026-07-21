import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {processParticipationFlagUpdates} from "../../../src/epoch/processParticipationFlagUpdates.js";

describe("processParticipationFlagUpdates", () => {
  it("preserves Gloas progressive participation trees", () => {
    const validatorCount = 64;
    const state = ssz.gloas.BeaconState.defaultViewDU();
    state.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, () => 1)
    );
    state.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, () => 7)
    );

    processParticipationFlagUpdates(state);

    expect(state.previousEpochParticipation.getAll()).toEqual(Array.from({length: validatorCount}, () => 7));
    expect(state.currentEpochParticipation.getAll()).toEqual(Array.from({length: validatorCount}, () => 0));
    expect(ssz.gloas.EpochParticipation.toValueFromViewDU(state.currentEpochParticipation)).toEqual(
      Array.from({length: validatorCount}, () => 0)
    );
  });

  it("Gloas zeroed participation matches naive rebuild (root + bytes)", () => {
    // Length crossing progressive subtree boundaries and not a multiple of itemsPerChunk (32)
    const validatorCount = 673;
    const state = ssz.gloas.BeaconState.defaultViewDU();
    state.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, () => 1)
    );
    state.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, (_, i) => i % 8)
    );

    processParticipationFlagUpdates(state);

    // Differential oracle: the naive implementation this fast path replaces
    const naive = ssz.gloas.EpochParticipation.toViewDU(new Array<number>(validatorCount).fill(0));
    expect(state.currentEpochParticipation.hashTreeRoot()).toEqual(naive.hashTreeRoot());
    expect(state.currentEpochParticipation.serialize()).toEqual(naive.serialize());
  });
});
