import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState, PubkeyIndexMap} from "../../../src/index.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createCachedBeaconState(emptyState, {
      config: createBeaconConfig(config, emptyState.genesisValidatorsRoot),
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    });
  });
});
