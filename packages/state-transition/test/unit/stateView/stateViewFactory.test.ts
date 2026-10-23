import {expect, it} from "vitest";
import {createBeaconConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {isStatePostGloas} from "../../../src/stateView/interface.js";
import {
  createBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "../../../src/stateView/stateViewFactory.js";
import {generateValidators} from "../../utils/validator.js";

it("rejects native startup and historical regeneration from a Heze state", () => {
  const config = createBeaconConfig(
    {
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 1,
      HEZE_FORK_EPOCH: 2,
    },
    new Uint8Array(32)
  );
  const state = ssz.heze.BeaconState.defaultValue();
  state.slot = config.HEZE_FORK_EPOCH * SLOTS_PER_EPOCH;
  const opts = {nativeStateTransition: true as const, config, stateBytes: ssz.heze.BeaconState.serialize(state)};
  expect(() => createBeaconStateView(opts)).toThrow("Native state transition does not support heze");
  expect(() => createBeaconStateViewForHistoricalRegen(opts)).toThrow("Native state transition does not support heze");
});

it("loads Gloas startup and historical views with native state roots and builder fields", () => {
  const config = createBeaconConfig(
    {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
      HEZE_FORK_EPOCH: Infinity,
    },
    new Uint8Array(32)
  );
  const state = ssz.gloas.BeaconState.defaultValue();
  state.validators = generateValidators(16, {
    activation: 0,
    exit: Infinity,
    withdrawableEpoch: Infinity,
    balance: MAX_EFFECTIVE_BALANCE,
  });
  state.balances = state.validators.map(() => MAX_EFFECTIVE_BALANCE);
  state.previousEpochParticipation = state.validators.map(() => 0);
  state.currentEpochParticipation = state.validators.map(() => 0);
  state.inactivityScores = state.validators.map(() => 0);
  state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  state.pendingDeposits.push(ssz.gloas.PendingDeposit.defaultValue());
  state.pendingPartialWithdrawals.push(ssz.gloas.PendingPartialWithdrawal.defaultValue());
  state.pendingConsolidations.push(ssz.gloas.PendingConsolidation.defaultValue());
  state.executionPayloadAvailability.set(3, true);
  state.latestExecutionPayloadBid.gasLimit = (1n << 64n) - 1n;
  state.latestExecutionPayloadBid.executionPayment = (1n << 63n) + 1n;
  state.builders = [
    {...ssz.gloas.Builder.defaultValue(), pubkey: state.validators[0].pubkey, withdrawableEpoch: Infinity},
  ];
  const bytes = ssz.gloas.BeaconState.serialize(state);
  const opts = {nativeStateTransition: true as const, config, stateBytes: bytes};
  for (const create of [createBeaconStateView, createBeaconStateViewForHistoricalRegen]) {
    const view = create(opts);
    try {
      expect(view.forkName).toBe(ForkName.gloas);
      expect(view.hashTreeRoot()).toEqual(ssz.gloas.BeaconState.hashTreeRoot(state));
      expect(view.serialize()).toEqual(bytes);
      if (!isStatePostGloas(view)) throw Error("Expected Gloas view");
      expect(view.pendingDeposits).toEqual(state.pendingDeposits);
      expect(view.pendingPartialWithdrawals).toEqual(state.pendingPartialWithdrawals);
      expect(view.pendingConsolidations).toEqual(state.pendingConsolidations);
      expect(view.getBuildersLength()).toBe(1);
      expect(view.latestExecutionPayloadBid).toEqual(state.latestExecutionPayloadBid);
      expect(view.getBuilder(0)).toEqual(state.builders[0]);
      expect(view.executionPayloadAvailability.get(3)).toBe(true);
    } finally {
      view.release();
    }
  }
}, 60000);
