import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {BeaconStateView, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {OpPool} from "../../../../src/chain/opPools/opPool.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";

const chainConfig = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 1,
  BELLATRIX_FORK_EPOCH: 2,
  CAPELLA_FORK_EPOCH: 3,
  DENEB_FORK_EPOCH: 4,
  ELECTRA_FORK_EPOCH: 5,
});

describe("OpPool voluntary exits", () => {
  it("keeps previous-fork exits that are still includable before deneb", () => {
    const headSlot = computeStartSlotAtEpoch(chainConfig.BELLATRIX_FORK_EPOCH);
    const {pool, headBlock, headState} = createPoolContext(headSlot);

    pool.insertVoluntaryExit(createVoluntaryExit(chainConfig.ALTAIR_FORK_EPOCH));
    pool.pruneAll(headBlock, headState);

    expect(pool.getAllVoluntaryExits()).toHaveLength(1);
  });

  it("prunes exits whose signatures are no longer includable before deneb", () => {
    const headSlot = computeStartSlotAtEpoch(chainConfig.BELLATRIX_FORK_EPOCH);
    const {pool, headBlock, headState} = createPoolContext(headSlot);

    pool.insertVoluntaryExit(createVoluntaryExit(0));
    pool.pruneAll(headBlock, headState);

    expect(pool.getAllVoluntaryExits()).toHaveLength(0);
  });

  it("keeps older-fork exits after deneb because signatures remain perpetually valid", () => {
    const headSlot = computeStartSlotAtEpoch(chainConfig.ELECTRA_FORK_EPOCH);
    const {pool, headBlock, headState} = createPoolContext(headSlot);

    pool.insertVoluntaryExit(createVoluntaryExit(chainConfig.ALTAIR_FORK_EPOCH));
    pool.pruneAll(headBlock, headState);

    expect(pool.getAllVoluntaryExits()).toHaveLength(1);
  });
});

function createPoolContext(headSlot: number) {
  const state = generateState({slot: headSlot}, chainConfig);
  const config = createBeaconConfig(chainConfig, state.genesisValidatorsRoot);
  const headBlock = config.getForkTypes(headSlot).SignedBeaconBlock.defaultValue();
  headBlock.message.slot = headSlot;

  return {
    pool: new OpPool(config),
    headBlock,
    headState: new BeaconStateView(createCachedBeaconStateTest(state, config)),
  };
}

function createVoluntaryExit(epoch: number): phase0.SignedVoluntaryExit {
  return {
    ...ssz.phase0.SignedVoluntaryExit.defaultValue(),
    message: {
      validatorIndex: 0,
      epoch,
    },
  };
}
