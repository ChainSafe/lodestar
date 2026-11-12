import {beforeEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../../src/block/externalData.js";
import type {CachedBeaconStateAllForks} from "../../../src/cache/stateCache.js";
import type {StateTransitionModules, StateTransitionOpts} from "../../../src/stateTransition.js";

const stateTransitionMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/stateTransition.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/stateTransition.js")>();
  return {...actual, stateTransition: stateTransitionMock};
});

const {BeaconStateView} = await import("../../../src/stateView/beaconStateView.js");

describe("BeaconStateView", () => {
  beforeEach(() => {
    stateTransitionMock.mockReset();
  });

  it("uses the parsed block and ignores the serialized bytes", () => {
    const preState = {config: {}} as unknown as CachedBeaconStateAllForks;
    const postState = {config: {}} as unknown as CachedBeaconStateAllForks;
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    const options: StateTransitionOpts = {
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    };
    const modules: StateTransitionModules = {};
    stateTransitionMock.mockReturnValue(postState);

    const result = new BeaconStateView(preState).stateTransition({block: signedBlock}, options, modules);

    expect(stateTransitionMock).toHaveBeenCalledWith(preState, signedBlock, options, modules);
    expect(result).toBeInstanceOf(BeaconStateView);
    expect((result as InstanceType<typeof BeaconStateView>).cachedState).toBe(postState);
  });

  it("computes zero-inactive effective balances once per view", () => {
    const validators = [{slashed: false}, {slashed: true}, {slashed: false}];
    const forEachValue = vi.fn((fn: (validator: {slashed: boolean}, i: number) => void) => validators.forEach(fn));
    const state = {
      config: {},
      epochCtx: {
        currentShuffling: {activeIndices: Uint32Array.from([0, 1])},
        effectiveBalanceIncrements: Uint16Array.from([32, 32, 32]),
      },
      validators: {length: validators.length, forEachValue},
    } as unknown as CachedBeaconStateAllForks;
    const view = new BeaconStateView(state);

    const balances = view.getEffectiveBalanceIncrementsZeroInactive();

    expect(Array.from(balances)).toEqual([32, 0, 0]);
    expect(view.getEffectiveBalanceIncrementsZeroInactive()).toBe(balances);
    expect(forEachValue).toHaveBeenCalledTimes(1);
  });
});
