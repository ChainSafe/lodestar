import {fromHexString} from "@chainsafe/ssz";
import {describe, it, expect} from "vitest";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ssz} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {config as defaultConfig} from "@lodestar/config/default";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {createCachedBeaconStateTest} from "../utils/state.js";
import {createCachedBeaconState, loadCachedBeaconState} from "../../src/cache/stateCache.js";
import {interopPubkeysCached} from "../utils/interop.js";
import {modifyStateSameValidator, newStateWithValidators} from "../utils/capella.js";

describe("CachedBeaconState", () => {
  it("Clone and mutate", () => {
    const stateView = ssz.altair.BeaconState.defaultViewDU();
    const state1 = createCachedBeaconStateTest(stateView);
    const state2 = state1.clone();

    state1.slot = 1;
    expect(state2.slot).toBe(0);

    const prevRoot = state2.currentJustifiedCheckpoint.root;
    const newRoot = Buffer.alloc(32, 1);
    state1.currentJustifiedCheckpoint.root = newRoot;
    expect(toHexString(state2.currentJustifiedCheckpoint.root)).toBe(toHexString(prevRoot));

    state1.epochCtx.epoch = 1;
    expect(state2.epochCtx.epoch).toBe(0);
  });

  it("Clone and mutate cache pre-Electra", () => {
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

    expect(state1.epochCtx.getValidatorIndex(pubkey1)).toBe(index1);
    expect(state2.epochCtx.getValidatorIndex(pubkey1)).toBe(index1);
    expect(state1.epochCtx.getValidatorIndex(pubkey2)).toBe(index2);
    expect(state2.epochCtx.getValidatorIndex(pubkey2)).toBe(index2);
  });

  it("Clone and mutate cache post-Electra", () => {
    const stateView = ssz.electra.BeaconState.defaultViewDU();
    const state1 = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
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

    expect(state1.epochCtx.getValidatorIndex(pubkey1)).toBe(index1);
    expect(state2.epochCtx.getValidatorIndex(pubkey1)).toBe(index1);
    expect(state1.epochCtx.getValidatorIndex(pubkey2)).toBe(null);
    expect(state2.epochCtx.getValidatorIndex(pubkey2)).toBe(index2);
  });

  it("Auto-commit on hashTreeRoot", () => {
    // Use Checkpoint instead of BeaconState to speed up the test
    const cp1 = ssz.phase0.Checkpoint.defaultViewDU();
    const cp2 = ssz.phase0.Checkpoint.defaultViewDU();

    cp1.epoch = 1;
    cp2.epoch = 1;

    // Only commit state1 beforehand
    cp1.commit();
    expect(toHexString(cp1.hashTreeRoot())).toBe(toHexString(cp2.hashTreeRoot()));
  });

  it("Auto-commit on serialize", () => {
    const cp1 = ssz.phase0.Checkpoint.defaultViewDU();
    const cp2 = ssz.phase0.Checkpoint.defaultViewDU();

    cp1.epoch = 1;
    cp2.epoch = 1;

    // Only commit state1 beforehand
    cp1.commit();
    expect(toHexString(cp1.serialize())).toBe(toHexString(cp2.serialize()));
  });

  describe("loadCachedBeaconState", () => {
    const numValidator = 16;
    const pubkeys = interopPubkeysCached(2 * numValidator);

    const stateView = newStateWithValidators(numValidator);
    const config = createBeaconConfig(defaultConfig, stateView.genesisValidatorsRoot);
    const seedState = createCachedBeaconState(
      stateView,
      {
        config,
        pubkey2index: new PubkeyIndexMap(),
        index2pubkey: [],
      },
      {skipSyncCommitteeCache: true}
    );

    const capellaStateType = ssz.capella.BeaconState;

    for (let validatorCountDelta = -numValidator + 1; validatorCountDelta <= numValidator; validatorCountDelta++) {
      const testName = `loadCachedBeaconState - ${validatorCountDelta > 0 ? "more" : "less"} ${Math.abs(
        validatorCountDelta
      )} validators`;
      it(testName, () => {
        const state = modifyStateSameValidator(stateView);
        for (let i = 0; i < state.validators.length; i++) {
          // only modify some validators
          if (i % 5 === 0) {
            state.inactivityScores.set(i, state.inactivityScores.get(i) + 1);
            state.validators.get(i).effectiveBalance += 1;
          }
        }

        if (validatorCountDelta < 0) {
          state.validators = state.validators.sliceTo(state.validators.length - 1 + validatorCountDelta);

          // inactivityScores
          if (state.inactivityScores.length - 1 + validatorCountDelta >= 0) {
            state.inactivityScores = state.inactivityScores.sliceTo(
              state.inactivityScores.length - 1 + validatorCountDelta
            );
          } else {
            state.inactivityScores = capellaStateType.fields.inactivityScores.defaultViewDU();
          }

          // previousEpochParticipation
          if (state.previousEpochParticipation.length - 1 + validatorCountDelta >= 0) {
            state.previousEpochParticipation = state.previousEpochParticipation.sliceTo(
              state.previousEpochParticipation.length - 1 + validatorCountDelta
            );
          } else {
            state.previousEpochParticipation = capellaStateType.fields.previousEpochParticipation.defaultViewDU();
          }

          // currentEpochParticipation
          if (state.currentEpochParticipation.length - 1 + validatorCountDelta >= 0) {
            state.currentEpochParticipation = state.currentEpochParticipation.sliceTo(
              state.currentEpochParticipation.length - 1 + validatorCountDelta
            );
          } else {
            state.currentEpochParticipation = capellaStateType.fields.currentEpochParticipation.defaultViewDU();
          }
        } else {
          // more validators
          for (let i = 0; i < validatorCountDelta; i++) {
            const validator = ssz.phase0.Validator.defaultViewDU();
            validator.pubkey = pubkeys[numValidator + i];
            state.validators.push(validator);
            state.inactivityScores.push(1);
            state.previousEpochParticipation.push(0b11111111);
            state.currentEpochParticipation.push(0b11111111);
          }
        }
        state.commit();

        // confirm loadState() result
        const stateBytes = state.serialize();
        const newCachedState = loadCachedBeaconState(seedState, stateBytes, {
          skipSyncCommitteeCache: true,
        });
        const newStateBytes = newCachedState.serialize();
        expect(newStateBytes).toEqual(stateBytes);
        expect(newCachedState.hashTreeRoot()).toEqual(state.hashTreeRoot());
        const cachedState = createCachedBeaconState(
          state,
          {
            config,
            pubkey2index: new PubkeyIndexMap(),
            index2pubkey: [],
            shufflingCache: seedState.epochCtx.shufflingCache,
          },
          {skipSyncCommitteeCache: true}
        );
        // validatorCountDelta < 0 is unrealistic and shuffling computation results in a different result
        if (validatorCountDelta >= 0) {
          expect(newCachedState.epochCtx).toEqual(cachedState.epochCtx);
        }

        // confirm loadCachedBeaconState() result
        for (let i = 0; i < newCachedState.validators.length; i++) {
          expect(newCachedState.epochCtx.pubkey2index.get(newCachedState.validators.get(i).pubkey)).toBe(i);
          expect(newCachedState.epochCtx.index2pubkey[i].toBytes()).toEqual(pubkeys[i]);
        }
      });
    }
  });
});
