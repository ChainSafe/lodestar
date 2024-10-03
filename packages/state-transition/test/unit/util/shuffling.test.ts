import {describe, it, expect} from "vitest";
import {generateState} from "../../utils/state.js";
import {computeEpochShuffling, computeEpochShufflingAsync} from "../../../src/util/epochShuffling.js";
import {computeEpochAtSlot} from "../../../src/index.js";

describe("EpochShuffling", () => {
  it("async and sync versions should be identical", async () => {
    const activeIndices = Uint32Array.from(Array.from({length: 1_000}, (_, i) => i));
    const state = generateState();
    state.slot = 12345;
    state.validators = activeIndices;

    const epoch = computeEpochAtSlot(state.slot);

    const sync = computeEpochShuffling(state, activeIndices, epoch);
    const async = await computeEpochShufflingAsync(state, activeIndices, epoch);

    expect(sync).toStrictEqual(async);
  });
});
