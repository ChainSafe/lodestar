import {describe, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {createFinalizedCachedBeaconState, PubkeyIndexMap} from "../../../src/index.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createFinalizedCachedBeaconState(emptyState, {
      config: createBeaconConfig(config, emptyState.genesisValidatorsRoot),
      finalizedPubkey2index: new PubkeyIndexMap(),
      finalizedIndex2pubkey: [],
    });
  });
});
