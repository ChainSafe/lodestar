import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {ssz} from "@chainsafe/lodestar-types";
import {createCachedBeaconState, PubkeyIndexMap} from "../../../src/index.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createCachedBeaconState(emptyState, {
      config: createIBeaconConfig(config, emptyState.genesisValidatorsRoot),
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    });
  });
});
