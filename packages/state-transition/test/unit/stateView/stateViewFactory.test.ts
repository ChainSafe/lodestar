import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {StateViewErrorCode} from "../../../src/stateView/errors.js";
import {isStatePostAltair} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";
import {createStateViewFactory} from "../../../src/stateView/stateViewFactory.js";
import {generateState} from "../../../src/testUtils/state.js";
import {generateValidators} from "../../utils/validator.js";

const validators = generateValidators(16, {
  activation: 0,
  exit: FAR_FUTURE_EPOCH,
  withdrawableEpoch: FAR_FUTURE_EPOCH,
  balance: MAX_EFFECTIVE_BALANCE,
});
const config = createBeaconConfig(getConfig(ForkName.phase0), new Uint8Array(32));

function createFixture() {
  pubkeyCache.syncPubkeys(validators);
  return generateState({genesisTime: 0, validators, balances: validators.map(() => MAX_EFFECTIVE_BALANCE)});
}

describe("state view factory", () => {
  it("defaults to TypeScript and computes a block root without serialization", () => {
    const state = createFixture();
    const factory = createStateViewFactory(config, pubkeyCache);
    const view = factory.createFromState(state);
    const advanced = view.processSlots(1);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = advanced.getBeaconProposer(1);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
    const serialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "serialize").mockImplementation(() => {
      throw new Error("TypeScript must not serialize block inputs");
    });
    try {
      const result = view.computeNewStateRoot({block}, {});
      expect(result.postState).toBeInstanceOf(BeaconStateView);
      expect(result.postState.slot).toBe(1);
      expect(result.newStateRoot).toEqual(result.postState.hashTreeRoot());
      expect(view.slot).toBe(0);
      expect(factory.native).toBe(false);
      expect(Object.isFrozen(factory)).toBe(true);
    } finally {
      serialize.mockRestore();
    }
  });

  it.each([false, true])("retains implementation through reload and slot advance, native=%s", (native) => {
    const fixture = createFixture();
    const factory = createStateViewFactory(config, pubkeyCache, {native});
    const view = factory.createFromBytes(fixture.serialize());
    const advanced = view.processSlots(1);
    const reloaded = advanced.loadOtherState(fixture.serialize());
    for (const state of [view, advanced, reloaded]) {
      expect(state, `implementation at slot ${state.slot}`).toBeInstanceOf(
        native ? NativeBeaconStateView : BeaconStateView
      );
    }
    expect(view.slot).toBe(0);
    expect(advanced.slot).toBe(1);
    expect(reloaded.slot).toBe(0);
    expect(reloaded.hashTreeRoot()).toEqual(view.hashTreeRoot());
  });

  it.each([ForkName.gloas, ForkName.heze])("rejects native creation of %s", (fork) => {
    const forkConfig = createBeaconConfig(getConfig(fork), new Uint8Array(32));
    const factory = createStateViewFactory(forkConfig, pubkeyCache, {native: true});
    const bytes = ssz[fork].BeaconState.defaultViewDU().serialize();
    expect(() => factory.createFromBytes(bytes)).toThrowError(
      expect.objectContaining({type: expect.objectContaining({code: StateViewErrorCode.NATIVE_UNSUPPORTED_FORK, fork})})
    );
  });

  it("accepts the canonical slot duration with a deprecated preset default", () => {
    const slotConfig = createBeaconConfig({SLOT_DURATION_MS: 6000}, new Uint8Array(32));
    expect(slotConfig.SECONDS_PER_SLOT).toBe(12);
    const fixture = createFixture();
    const native = createStateViewFactory(slotConfig, pubkeyCache, {native: true}).createFromState(fixture);
    const typescript = createStateViewFactory(slotConfig, pubkeyCache).createFromState(fixture);
    expect(native.processSlots(1).hashTreeRoot()).toEqual(typescript.processSlots(1).hashTreeRoot());
  });

  it.each(["current", "epoch", "slot"])("matches TypeScript sync committee duties for %s lookups", (lookup) => {
    const fixture = createFixture();
    const altairConfig = createBeaconConfig({...getConfig(ForkName.phase0), ALTAIR_FORK_EPOCH: 1}, new Uint8Array(32));
    const native = createStateViewFactory(altairConfig, pubkeyCache, {native: true})
      .createFromState(fixture)
      .processSlots(SLOTS_PER_EPOCH);
    const typescript = createStateViewFactory(altairConfig, pubkeyCache)
      .createFromState(fixture)
      .processSlots(SLOTS_PER_EPOCH);
    if (!isStatePostAltair(native) || !isStatePostAltair(typescript)) {
      throw new Error("Expected Altair states after the fork transition");
    }
    const [actual, expected] = [native, typescript].map((state) =>
      lookup === "current"
        ? state.currentSyncCommitteeIndexed
        : lookup === "epoch"
          ? state.getIndexedSyncCommitteeAtEpoch(1)
          : state.getIndexedSyncCommittee(SLOTS_PER_EPOCH)
    );
    expect(actual.validatorIndexMap).toBeInstanceOf(Map);
    expect(actual.validatorIndices).toEqual(expected.validatorIndices);
    expect(actual.validatorIndexMap.size).toBe(expected.validatorIndexMap.size);
    for (const [validatorIndex, positions] of expected.validatorIndexMap) {
      expect(actual.validatorIndexMap.get(validatorIndex), `sync duties for validator ${validatorIndex}`).toEqual(
        positions
      );
    }
  });

  it("keeps native factory and descendant configuration after another setup", () => {
    const fixture = createFixture();
    const altairConfig = createBeaconConfig({...getConfig(ForkName.phase0), ALTAIR_FORK_EPOCH: 1}, new Uint8Array(32));
    const first = createStateViewFactory(altairConfig, pubkeyCache, {native: true});
    const beforeSecondSetup = first.createFromBytes(fixture.serialize());
    const second = createStateViewFactory(config, pubkeyCache, {native: true});
    const afterSecondSetup = first.createFromBytes(fixture.serialize());
    expect(beforeSecondSetup.processSlots(SLOTS_PER_EPOCH).forkName).toBe(ForkName.altair);
    expect(afterSecondSetup.processSlots(SLOTS_PER_EPOCH).forkName).toBe(ForkName.altair);
    expect(beforeSecondSetup.loadOtherState(fixture.serialize()).processSlots(SLOTS_PER_EPOCH).forkName).toBe(
      ForkName.altair
    );
    expect(second.createFromBytes(fixture.serialize()).processSlots(SLOTS_PER_EPOCH).forkName).toBe(ForkName.phase0);
  });
});
