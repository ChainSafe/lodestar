import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {computeEpochAtSlot} from "../../../src/index.js";
import {computeEpochShuffling, computeEpochShufflingAsync} from "../../../src/util/epochShuffling.js";
import {generateState} from "../../utils/state.js";

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
