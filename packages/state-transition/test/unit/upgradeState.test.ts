import {expect, describe, it} from "vitest";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {createBeaconConfig, ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";

import {upgradeStateToDeneb} from "../../src/slot/upgradeStateToDeneb.js";
import {upgradeStateToElectra} from "../../src/slot/upgradeStateToElectra.js";
import {createCachedBeaconState} from "../../src/cache/stateCache.js";

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
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToDeneb(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });
  it("upgradeStateToElectra", () => {
    const denebState = ssz.deneb.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.deneb);
    const stateView = createCachedBeaconState(
      denebState,
      {
        config: createBeaconConfig(config, denebState.genesisValidatorsRoot),
        pubkey2index: new PubkeyIndexMap(),
        index2pubkey: [],
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToElectra(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });
});

const ZERO_HASH = Buffer.alloc(32, 0);
/** default config with ZERO_HASH as genesisValidatorsRoot */
const config = createBeaconConfig(chainConfig, ZERO_HASH);

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
    case ForkName.electra:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: forkEpoch,
      });
  }
}
