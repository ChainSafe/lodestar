import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {createCachedBeaconState} from "../../../src";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultTreeBacked();
    createCachedBeaconState(config, emptyState);
  });
});
