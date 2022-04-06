import {ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {createCachedBeaconStateTest} from "../utils/state.js";

describe("CachedBeaconState", () => {
  it("Clone and mutate", () => {
    const stateView = ssz.altair.BeaconState.defaultViewDU();
    const state1 = createCachedBeaconStateTest(stateView);
    const state2 = state1.clone();

    state1.slot = 1;
    expect(state2.slot).to.equal(0, "state2.slot was mutated");

    const prevRoot = state2.currentJustifiedCheckpoint.root;
    const newRoot = Buffer.alloc(32, 1);
    state1.currentJustifiedCheckpoint.root = newRoot;
    expect(toHexString(state2.currentJustifiedCheckpoint.root)).to.equal(
      toHexString(prevRoot),
      "state2.currentJustifiedCheckpoint.root was mutated"
    );

    state1.epochCtx.epoch = 1;
    expect(state2.epochCtx.epoch).to.equal(0, "state2.epochCtx.epoch was mutated");
  });

  it("Auto-commit on hashTreeRoot", () => {
    // Use Checkpoint instead of BeaconState to speed up the test
    const cp1 = ssz.phase0.Checkpoint.defaultViewDU();
    const cp2 = ssz.phase0.Checkpoint.defaultViewDU();

    cp1.epoch = 1;
    cp2.epoch = 1;

    // Only commit state1 beforehand
    cp1.commit();
    expect(toHexString(cp1.hashTreeRoot())).to.equal(
      toHexString(cp2.hashTreeRoot()),
      ".hashTreeRoot() does not automatically commit"
    );
  });

  it("Auto-commit on serialize", () => {
    const cp1 = ssz.phase0.Checkpoint.defaultViewDU();
    const cp2 = ssz.phase0.Checkpoint.defaultViewDU();

    cp1.epoch = 1;
    cp2.epoch = 1;

    // Only commit state1 beforehand
    cp1.commit();
    expect(toHexString(cp1.serialize())).to.equal(
      toHexString(cp2.serialize()),
      ".serialize() does not automatically commit"
    );
  });
});
