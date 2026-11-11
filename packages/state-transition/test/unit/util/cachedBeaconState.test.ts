import {describe, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/index.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createCachedBeaconState(emptyState, {
      config: createBeaconConfig(config, emptyState.genesisValidatorsRoot),
      pubkeyCache,
    });
  });
});
