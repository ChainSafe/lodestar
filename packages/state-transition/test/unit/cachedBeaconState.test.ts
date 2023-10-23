import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {createChainForkConfig} from "@lodestar/config";
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

  it("Clone and mutate cache pre-6110", () => {
    const stateView = ssz.altair.BeaconState.defaultViewDU();
    const state1 = createCachedBeaconStateTest(stateView);

    const pubkey1 = fromHexString(
      "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
    );
    const index1 = 123;
    const pubkey2 = fromHexString(
      "0xa41726266b1d83ef609d759ba7796d54cfe549154e01e4730a3378309bc81a7638140d7e184b33593c072595f23f032d"
    );
    const index2 = 456;

    state1.epochCtx.addPubkey(index1, pubkey1);

    const state2 = state1.clone();
    state2.epochCtx.addPubkey(index2, pubkey2);

    expect(state1.epochCtx.getValidatorIndex(pubkey1)).to.equal(
      index1,
      "addPubkey() is not reflected in getValidatorIndex()"
    );
    expect(state2.epochCtx.getValidatorIndex(pubkey1)).to.equal(
      index1,
      "cloned state does not maintain cache from original state"
    );
    expect(state1.epochCtx.getValidatorIndex(pubkey2)).to.equal(
      index2,
      "original state cache was not updated when inserting pubkeys into cloned state cache"
    );
    expect(state2.epochCtx.getValidatorIndex(pubkey2)).to.equal(
      index2,
      "addPubkey() is not reflected in getValidatorIndex()"
    );
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  it("Clone and mutate cache post-6110", () => {
    const stateView = ssz.eip6110.BeaconState.defaultViewDU();
    const state1 = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        EIP6110_FORK_EPOCH: 0,
      }),
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    );

    const pubkey1 = fromHexString(
      "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576"
    );
    const index1 = 123;
    const pubkey2 = fromHexString(
      "0xa41726266b1d83ef609d759ba7796d54cfe549154e01e4730a3378309bc81a7638140d7e184b33593c072595f23f032d"
    );
    const index2 = 456;

    state1.epochCtx.addPubkey(index1, pubkey1);

    const state2 = state1.clone();
    state2.epochCtx.addPubkey(index2, pubkey2);

    expect(state1.epochCtx.getValidatorIndex(pubkey1)).to.equal(
      index1,
      "addPubkey() is not reflected in getValidatorIndex()"
    );
    expect(state2.epochCtx.getValidatorIndex(pubkey1)).to.equal(
      index1,
      "cloned state does not maintain cache from original state"
    );
    expect(state1.epochCtx.getValidatorIndex(pubkey2)).to.equal(
      undefined,
      "original state cache was updated when inserting pubkeys into cloned state cache"
    );
    expect(state2.epochCtx.getValidatorIndex(pubkey2)).to.equal(
      index2,
      "addPubkey() is not reflected in getValidatorIndex()"
    );
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
