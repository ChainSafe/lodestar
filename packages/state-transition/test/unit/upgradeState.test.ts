import {describe, expect, it} from "vitest";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createPubkeyCache} from "../../src/cache/pubkeyCache.js";
import {createCachedBeaconState} from "../../src/cache/stateCache.js";
import {processSlots} from "../../src/stateTransition.js";
import {
  computePayloadTimelinessCommittee,
  getPayloadTimelinessCommittee,
  initializePayloadTimelinessCommittee,
} from "../../src/util/gloas.js";
import {upgradeStateToDeneb} from "../../src/slot/upgradeStateToDeneb.js";
import {upgradeStateToElectra} from "../../src/slot/upgradeStateToElectra.js";
import {upgradeStateToGloas} from "../../src/slot/upgradeStateToGloas.js";
import {BeaconStateFulu, BeaconStateGloas, CachedBeaconStateFulu, CachedBeaconStateGloas} from "../../src/types.js";
import {generateState} from "../utils/state.js";
import {generateValidators} from "../utils/validator.js";

describe("upgradeState", () => {
  it("upgradeStateToDeneb", () => {
    const capellaState = ssz.capella.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.capella);
    const stateView = createCachedBeaconState(
      capellaState,
      {
        config: createBeaconConfig(config, capellaState.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
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
        pubkeyCache: createPubkeyCache(),
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToElectra(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });

  it("upgradeStateToGloas initializes the current PTC", () => {
    const config = getConfig(ForkName.fulu);
    const fuluState = generateFuluState(config);
    const stateView = createCachedBeaconState(
      fuluState,
      {
        config: createBeaconConfig(config, fuluState.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
      },
      {skipSyncCommitteeCache: true}
    );
    seedPayloadTimelinessInputs(stateView as CachedBeaconStateFulu);

    const newState = upgradeStateToGloas(stateView as CachedBeaconStateFulu);

    expect(() => newState.toValue()).not.toThrow();
    expect(Array.from(getPayloadTimelinessCommittee(newState, newState.slot))).toEqual(
      Array.from(computePayloadTimelinessCommittee(newState))
    );
  });

  it("processSlots rotates previous/current PTC within an epoch", () => {
    const state = getInitializedGloasState();
    const previousCurrentPtc = Array.from(getPayloadTimelinessCommittee(state, state.slot));

    const postState = processSlots(state, state.slot + 1) as CachedBeaconStateGloas;

    expect(Array.from(getPayloadTimelinessCommittee(postState, postState.slot - 1))).toEqual(previousCurrentPtc);
    expect(Array.from(getPayloadTimelinessCommittee(postState, postState.slot))).toEqual(
      Array.from(computePayloadTimelinessCommittee(postState))
    );
  });

  it("processSlots rotates previous/current PTC across an epoch boundary", () => {
    const state = getInitializedGloasState(SLOTS_PER_EPOCH - 1);
    const previousCurrentPtc = Array.from(getPayloadTimelinessCommittee(state, state.slot));

    const postState = processSlots(state, state.slot + 1) as CachedBeaconStateGloas;

    expect(Array.from(getPayloadTimelinessCommittee(postState, postState.slot - 1))).toEqual(previousCurrentPtc);
    expect(Array.from(getPayloadTimelinessCommittee(postState, postState.slot))).toEqual(
      Array.from(computePayloadTimelinessCommittee(postState))
    );
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
    case ForkName.fulu:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: forkEpoch,
      });
    case ForkName.gloas:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: forkEpoch,
      });
  }
}

function getInitializedGloasState(slot = 0): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const gloasState = generateGloasState(config, slot);
  const stateView = createCachedBeaconState(
    gloasState,
    {
      config: createBeaconConfig(config, gloasState.genesisValidatorsRoot),
      pubkeyCache: createPubkeyCache(),
    },
    {skipSyncCommitteeCache: true}
  ) as CachedBeaconStateGloas;
  seedPayloadTimelinessInputs(stateView);
  stateView.epochCtx.previousShuffling = stateView.epochCtx.currentShuffling;
  stateView.epochCtx.nextShuffling = stateView.epochCtx.currentShuffling;
  initializePayloadTimelinessCommittee(stateView);
  stateView.commit();

  return stateView;
}

function generateFuluState(config: ChainForkConfig, slot = 0): BeaconStateFulu {
  return generateState(
    {
      slot,
      validators: generateValidators(16, {
        activation: 0,
        exit: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
        balance: MAX_EFFECTIVE_BALANCE,
      }),
    },
    config
  ) as BeaconStateFulu;
}

function generateGloasState(config: ChainForkConfig, slot = 0): BeaconStateGloas {
  return generateState(
    {
      slot,
      validators: generateValidators(256, {
        activation: 0,
        exit: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
        balance: MAX_EFFECTIVE_BALANCE,
      }),
    },
    config
  ) as BeaconStateGloas;
}

function seedPayloadTimelinessInputs(state: CachedBeaconStateFulu | CachedBeaconStateGloas): void {
  const activeIndices = new Uint32Array([0, 1, 2, 3]);
  const committees = Array.from({length: SLOTS_PER_EPOCH}, () => [activeIndices]);

  state.epochCtx.currentShuffling = {
    epoch: 0,
    activeIndices,
    shuffling: activeIndices,
    committees,
    committeesPerSlot: 1,
  };
  state.epochCtx.effectiveBalanceIncrements = new Uint16Array(state.validators.length).fill(
    MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT
  );
}
