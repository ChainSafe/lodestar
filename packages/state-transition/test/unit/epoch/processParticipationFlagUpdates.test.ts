import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {processParticipationFlagUpdates} from "../../../src/epoch/processParticipationFlagUpdates.js";
import type {CachedBeaconStateAltair} from "../../../src/types.js";

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

    processParticipationFlagUpdates(state as unknown as CachedBeaconStateAltair);

    expect(state.previousEpochParticipation.getAll()).toEqual(Array.from({length: validatorCount}, () => 7));
    expect(state.currentEpochParticipation.getAll()).toEqual(Array.from({length: validatorCount}, () => 0));
    expect(ssz.gloas.EpochParticipation.toValueFromViewDU(state.currentEpochParticipation)).toEqual(
      Array.from({length: validatorCount}, () => 0)
    );
  });
});
