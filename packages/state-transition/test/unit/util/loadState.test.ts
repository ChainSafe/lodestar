import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/networks";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BeaconStateAltair} from "../../../src/types.js";
import {loadState, loadStateAndValidators} from "../../../src/util/loadState/loadState.js";

describe("loadStateAndValidators", () => {
  const numValidator = 10;
  const config = createChainForkConfig(mainnetChainConfig);

  const testCases: {name: ForkName; slot: number}[] = [
    {name: ForkName.phase0, slot: 100},
    {name: ForkName.altair, slot: mainnetChainConfig.ALTAIR_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
    {name: ForkName.capella, slot: mainnetChainConfig.CAPELLA_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
    {name: ForkName.deneb, slot: mainnetChainConfig.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH + 100},
  ];

  for (const {name, slot} of testCases) {
    it(`fork: ${name}, slot: ${slot}`, () => {
      const state = config.getForkTypes(slot).BeaconState.defaultViewDU();
      state.slot = slot;
      for (let i = 0; i < numValidator; i++) {
        const validator = ssz.phase0.Validator.defaultViewDU();
        validator.pubkey = new Uint8Array(48).fill(i);
        state.validators.push(validator);
        state.balances.push(32 * 1e9);
      }
      state.commit();

      const stateBytes = state.serialize();
      const stateRoot = state.hashTreeRoot();
      const {state: loadedState, validatorsBytes} = loadStateAndValidators(config, stateBytes);
      expect(loadedState.hashTreeRoot()).toEqual(stateRoot);
      // serialize() somehow takes time, however comparing state root would be enough
      // expect(loadedState.serialize()).toEqual(stateBytes);
      expect(validatorsBytes).toEqual(state.validators.serialize());
    });
  }
});

describe("loadState does not poison seed state's cache", () => {
  // Regression test for a subtle SSZ TreeViewDU aliasing bug. loadState() used to clone the
  // seed's validators / inactivityScores subviews with the default transfer-cache semantics:
  // the clone shared the same internal `nodes[]` / `caches[]` arrays as the cache snapshot
  // stored on the seed container at `seedState.caches[validatorsFieldIndex]`. A subsequent
  // `migratedState.commit()` writes modified validator nodes into that shared array, silently
  // corrupting the seed container's child-view cache snapshot. The corruption is only
  // observed when the seed is later cloned with transfer-cache (the path verifyBlock takes
  // via the default `preState.clone()`) and the new clone reads a modified index, at which
  // point it returns the migrated state's validator instead of the seed's.
  //
  // Fix: clone the seed's validators/inactivityScores subviews with `clone(true)` so the
  // migrated subview gets a fresh (empty) cache and its commit cannot reach into the seed's
  // cache arrays.
  const numValidator = 10;
  const config = createChainForkConfig(mainnetChainConfig);
  // altair+ so both validators and inactivityScores paths are exercised
  const slot = mainnetChainConfig.ALTAIR_FORK_EPOCH * SLOTS_PER_EPOCH + 100;
  const modifiedIndex = 0;

  function buildState(mutateFn?: (state: BeaconStateAltair) => void): BeaconStateAltair {
    const state = config.getForkTypes(slot).BeaconState.defaultViewDU() as BeaconStateAltair;
    state.slot = slot;
    for (let i = 0; i < numValidator; i++) {
      const validator = ssz.phase0.Validator.defaultViewDU();
      validator.pubkey = new Uint8Array(48).fill(i);
      validator.withdrawalCredentials = new Uint8Array(32).fill(i);
      validator.effectiveBalance = 32 * 1e9;
      state.validators.push(validator);
      state.balances.push(32 * 1e9);
      state.inactivityScores.push(i);
    }
    mutateFn?.(state);
    state.commit();
    return state;
  }

  it("seed state's transfer-cache clone does not surface the migrated validator at a modified index", () => {
    const seedState = buildState();
    const originalRoot = seedState.hashTreeRoot();
    const originalWC = new Uint8Array(32).fill(modifiedIndex);

    const modifiedState = buildState((state) => {
      const v = state.validators.get(modifiedIndex);
      v.withdrawalCredentials = new Uint8Array(32).fill(0xaa);
      state.validators.set(modifiedIndex, v);
      state.inactivityScores.set(modifiedIndex, 999);
    });
    const modifiedBytes = modifiedState.serialize();

    const {state: migrated} = loadState(config, seedState, modifiedBytes);
    expect(migrated.validators.getReadonly(modifiedIndex).withdrawalCredentials).toEqual(new Uint8Array(32).fill(0xaa));
    expect((migrated as BeaconStateAltair).inactivityScores.get(modifiedIndex)).toEqual(999);

    // IMPORTANT: do not read seedState.validators / call seedState.commit() between
    // loadState() and the clone. In production the head state keeps its cache snapshot
    // untouched across loadState, and the poisoning only surfaces on the NEXT block where
    // getPreState() clones with transfer-cache. Calling hashTreeRoot() / commit() here
    // would rewrite `seedState.caches[validatorsFieldIndex]` with the cleared subview's
    // cache and hide the bug.
    const postState = seedState.clone() as BeaconStateAltair;
    expect(postState.validators.getReadonly(modifiedIndex).withdrawalCredentials).toEqual(originalWC);
    expect(postState.inactivityScores.get(modifiedIndex)).toEqual(modifiedIndex);
    expect(postState.hashTreeRoot()).toEqual(originalRoot);
  });
});
