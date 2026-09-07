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
});
