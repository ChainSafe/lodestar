import {expect, describe, it} from "vitest";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {createBeaconConfig, ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";

import {upgradeStateToDeneb} from "../../src/slot/upgradeStateToDeneb.js";
import {createCachedBeaconState} from "../../src/cache/stateCache.js";
import {PubkeyIndexMap} from "../../src/cache/pubkeyCache.js";
import {MockShufflingCache} from "../utils/mockShufflingCache.js";

describe("upgradeState", () => {
  it("upgradeStateToDeneb", () => {
    const capellaState = ssz.capella.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.capella);
    const stateView = createCachedBeaconState(
      capellaState,
      {
        config: createBeaconConfig(config, capellaState.genesisValidatorsRoot),
        pubkey2index: new PubkeyIndexMap(),
        index2pubkey: [],
        shufflingCache: new MockShufflingCache(),
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToDeneb(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });
});

const ZERO_HASH = Buffer.alloc(32, 0);
/** default config with ZERO_HASH as genesisValidatorsRoot */
const config = createBeaconConfig(chainConfig, ZERO_HASH);

/* eslint-disable @typescript-eslint/naming-convention */
function getConfig(fork: ForkName, forkEpoch = 0): ChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return config;
    case ForkName.altair:
      return createChainForkConfig({ALTAIR_FORK_EPOCH: forkEpoch});
    case ForkName.bellatrix:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: forkEpoch,
      });
    case ForkName.capella:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.deneb:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: forkEpoch,
      });
  }
}
