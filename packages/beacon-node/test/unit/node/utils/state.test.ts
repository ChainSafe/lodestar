import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BeaconStateFulu} from "@lodestar/state-transition";
import {initDevState} from "../../../../src/node/utils/state.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";

describe("initDevState", () => {
  const electraConfig = createChainForkConfig({
    ...defaultChainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
  });
  const fuluConfig = createChainForkConfig({...electraConfig, FULU_FORK_EPOCH: 0});

  it("initializes the proposer lookahead of a fulu genesis state", () => {
    const opts = {genesisTime: 0};
    const fuluState = initDevState(fuluConfig, 64, opts) as BeaconStateFulu;
    const {epochCtx} = createCachedBeaconStateTest(initDevState(electraConfig, 64, opts), electraConfig);

    expect(fuluState.proposerLookahead.getAll()).toEqual([
      ...epochCtx.getBeaconProposers(),
      ...epochCtx.getBeaconProposersNextEpoch(),
    ]);
  });
});
