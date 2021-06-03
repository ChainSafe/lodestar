import {config} from "@chainsafe/lodestar-config/minimal";
import {createCachedBeaconState} from "../../../src";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = config.types.phase0.BeaconState.defaultTreeBacked();
    createCachedBeaconState(config, emptyState);
  });
});
