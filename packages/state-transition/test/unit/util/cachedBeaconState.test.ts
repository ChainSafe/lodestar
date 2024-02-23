import {describe, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {getNodeLogger} from "@lodestar/logger/node";
import {LogLevel} from "@lodestar/utils";
import {BaseShufflingCache} from "../../../src/cache/baseShufflingCache.js";
import {PubkeyIndexMap} from "../../../src/cache/pubkeyCache.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";

describe("CachedBeaconState", () => {
  it("Create empty CachedBeaconState", () => {
    const emptyState = ssz.phase0.BeaconState.defaultViewDU();

    createCachedBeaconState(emptyState, {
      config: createBeaconConfig(config, emptyState.genesisValidatorsRoot),
      logger: getNodeLogger({level: LogLevel.info}),
      shufflingCache: new BaseShufflingCache(),
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    });
  });
});
