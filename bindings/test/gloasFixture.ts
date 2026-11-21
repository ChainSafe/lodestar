import {ssz} from "@lodestar/types";
import {createStfState, stfConfig} from "./stfFixture.js";

export const gloasConfig = {
  ...stfConfig,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
  HEZE_FORK_EPOCH: Infinity,
};

export function createGloasState() {
  const fulu = createStfState();
  const state = ssz.gloas.BeaconState.defaultValue();
  const slotsPerEpoch = state.builderPendingPayments.length / 2;
  state.slot = slotsPerEpoch * 3 + 3;
  state.fork = {
    currentVersion: gloasConfig.GLOAS_FORK_VERSION,
    epoch: 0,
    previousVersion: gloasConfig.FULU_FORK_VERSION,
  };
  state.validators = fulu.validators;
  state.balances = fulu.balances;
  state.previousEpochParticipation = fulu.previousEpochParticipation;
  state.currentEpochParticipation = fulu.currentEpochParticipation;
  state.inactivityScores = fulu.inactivityScores;
  state.currentSyncCommittee = fulu.currentSyncCommittee;
  state.nextSyncCommittee = fulu.nextSyncCommittee;
  state.latestBlockHeader.slot = state.slot - 1;
  state.latestExecutionPayloadBid.builderIndex = Infinity;
  state.latestExecutionPayloadBid.slot = state.slot - 1;
  state.latestExecutionPayloadBid.blockHash.fill(3);
  state.latestExecutionPayloadBid.gasLimit = (1n << 64n) - 1n;
  state.latestExecutionPayloadBid.executionPayment = (1n << 63n) + 123n;
  state.builders = [
    {
      ...ssz.gloas.Builder.defaultValue(),
      balance: 1_000_000_000,
      pubkey: fulu.validators[0].pubkey,
      withdrawableEpoch: Infinity,
    },
  ];
  for (const committee of state.ptcWindow) {
    for (let i = 0; i < committee.length; i++) committee[i] = i % 3 === 0 ? 0 : 1;
  }
  return state;
}
