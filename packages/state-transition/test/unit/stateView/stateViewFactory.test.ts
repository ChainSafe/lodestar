import {expect, it} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  createBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "../../../src/stateView/stateViewFactory.js";

it("rejects native startup and historical regeneration from a Gloas state", () => {
  const config = createBeaconConfig(
    {...defaultChainConfig, GLOAS_FORK_EPOCH: defaultChainConfig.FULU_FORK_EPOCH + 1},
    new Uint8Array(32)
  );
  const state = ssz.gloas.BeaconState.defaultValue();
  state.slot = config.GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
  const opts = {nativeStateTransition: true as const, config, stateBytes: ssz.gloas.BeaconState.serialize(state)};
  expect(() => createBeaconStateView(opts)).toThrow("NativeBeaconStateView does not support Gloas");
  expect(() => createBeaconStateViewForHistoricalRegen(opts)).toThrow("NativeBeaconStateView does not support Gloas");
});
