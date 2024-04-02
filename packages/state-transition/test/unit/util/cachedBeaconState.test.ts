import {describe, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState, PubkeyIndexMap} from "../../../src/index.js";
import {MockShufflingCache} from "../../mocks/mockShufflingCache.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createCachedBeaconState(emptyState, {
      config: createBeaconConfig(config, emptyState.genesisValidatorsRoot),
      shufflingCache: new MockShufflingCache(),
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    });
  });
});
