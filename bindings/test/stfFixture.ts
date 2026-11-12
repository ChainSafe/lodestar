import {mainnetChainConfig} from "@lodestar/config/configs";
import {ssz} from "@lodestar/types";
import {SecretKey} from "../src/blst.js";

export const stfConfig = {...mainnetChainConfig, GLOAS_FORK_EPOCH: Infinity};

export function createStfState() {
  const state = ssz.fulu.BeaconState.defaultValue();
  state.slot = stfConfig.FULU_FORK_EPOCH * 32 + 31;
  state.fork = {
    currentVersion: stfConfig.FULU_FORK_VERSION,
    epoch: stfConfig.FULU_FORK_EPOCH,
    previousVersion: stfConfig.ELECTRA_FORK_VERSION,
  };
  state.validators = Array.from({length: 16}, (_, index) => {
    const seed = new Uint8Array(32);
    seed[0] = index + 1;
    return {
      ...ssz.phase0.Validator.defaultValue(),
      activationEpoch: 0,
      effectiveBalance: 32_000_000_000,
      exitEpoch: Infinity,
      pubkey: SecretKey.fromKeygen(seed).toPublicKey().toBytes(),
      withdrawableEpoch: Infinity,
    };
  });
  state.balances = state.validators.map(() => 32_000_000_000);
  state.previousEpochParticipation = state.validators.map(() => 0);
  state.currentEpochParticipation = state.validators.map(() => 0);
  state.inactivityScores = state.validators.map(() => 0);
  state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  return state;
}
