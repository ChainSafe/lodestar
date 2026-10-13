import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {IBeaconStateView, computeStartSlotAtEpoch, createBeaconStateView} from "@lodestar/state-transition";
import {initDevState} from "../../../src/node/utils/state.js";

describe("native state transition throws at the Gloas fork", () => {
  const validatorCount = 64;
  const gloasForkEpoch = 3;
  const config = createChainForkConfig({
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: gloasForkEpoch,
  });

  function processSlotsReleasing(state: IBeaconStateView, slot: number): IBeaconStateView {
    try {
      return state.processSlots(slot);
    } finally {
      state.release();
    }
  }

  it("processes every epoch before the fork and rejects the first Gloas slot", () => {
    const genesisState = initDevState(config, validatorCount, {genesisTime: 0});
    genesisState.commit();
    pubkeyCache.ensureCapacity(validatorCount);
    let state = createBeaconStateView({
      nativeStateTransition: true,
      config: createBeaconConfig(config, genesisState.genesisValidatorsRoot),
      stateBytes: genesisState.serialize(),
    });

    for (let epoch = 1; epoch < gloasForkEpoch; epoch++) {
      state = processSlotsReleasing(state, computeStartSlotAtEpoch(epoch));
      expect(state.epoch).toBe(epoch);
    }
    const gloasForkSlot = computeStartSlotAtEpoch(gloasForkEpoch);
    state = processSlotsReleasing(state, gloasForkSlot - 1);
    expect(state.slot).toBe(gloasForkSlot - 1);

    expect(() => state.processSlots(gloasForkSlot)).toThrow("UnsupportedFork");
    state.release();
  });
});
