import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  BUILDER_WITHDRAWAL_PREFIX,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  FAR_FUTURE_EPOCH,
  ForkName,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {IBeaconStateView} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";
import {
  createBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "../../../src/stateView/stateViewFactory.js";
import {
  addDeposits,
  createFuluState,
  expectBranchIndices,
  finalizedValidatorCount,
  forkEpoch,
  genesisRoot,
  keyA,
  orderBranches,
  slashFirstValidator,
} from "../../utils/pubkeyCache.js";

describe("NativeBeaconStateView validator pubkey cache branches", () => {
  beforeEach(() => {
    pubkeyCache.reset();
    pubkeyCache.ensureCapacity(4096);
  });

  it.each(["side first", "canonical first"] as const)("keeps Gloas branch indices independent: %s", (order) => {
    const config = createBeaconConfig(getConfig(ForkName.gloas, forkEpoch), genesisRoot);
    const forkSlot = forkEpoch * SLOTS_PER_EPOCH;
    const base = createFuluState(config, forkSlot - SLOTS_PER_EPOCH);
    const churn = Math.min(config.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT, config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
    addDeposits(base, config, churn, BUILDER_WITHDRAWAL_PREFIX);
    base.commit();
    const baseBytes = base.serialize();
    const sideState = base.clone();
    slashFirstValidator(sideState);
    sideState.commit();
    const sideBytes = sideState.serialize();
    const views: IBeaconStateView[] = [];
    const track = (view: IBeaconStateView): IBeaconStateView => {
      views.push(view);
      expect(view).toBeInstanceOf(NativeBeaconStateView);
      return view;
    };
    const processBranch = (stateBytes: Uint8Array, slot: number): IBeaconStateView => {
      const state = track(createBeaconStateView({nativeStateTransition: true, config, stateBytes}));
      return track(state.processSlots(slot));
    };

    try {
      const {side, canonical} = orderBranches(
        order,
        () => processBranch(sideBytes, forkSlot),
        () => processBranch(baseBytes, forkSlot + SLOTS_PER_EPOCH)
      );
      expectBranchIndices(side, canonical, null, finalizedValidatorCount);
    } finally {
      for (const view of views) view.release();
    }
  });

  it.each([false, true])(
    "loads trusted anchors densely and historical suffixes as candidates: native=%s",
    (nativeStateTransition) => {
      const config = createBeaconConfig(getConfig(ForkName.fulu), genesisRoot);
      const state = createFuluState(config, 0);
      const anchor = createBeaconStateView({nativeStateTransition, config, stateBytes: state.serialize()});
      let historical: IBeaconStateView | undefined;
      try {
        expect(pubkeyCache.size).toBe(finalizedValidatorCount);
        const pubkey = keyA.toPublicKey().toBytes();
        state.validators.push(
          ssz.phase0.Validator.toViewDU({
            ...ssz.phase0.Validator.defaultValue(),
            pubkey,
            activationEligibilityEpoch: FAR_FUTURE_EPOCH,
            activationEpoch: FAR_FUTURE_EPOCH,
            exitEpoch: FAR_FUTURE_EPOCH,
            withdrawableEpoch: FAR_FUTURE_EPOCH,
          })
        );
        state.balances.push(0);
        state.inactivityScores.push(0);
        state.previousEpochParticipation.push(0);
        state.currentEpochParticipation.push(0);
        historical = createBeaconStateViewForHistoricalRegen({
          nativeStateTransition,
          config,
          stateBytes: state.serialize(),
        });
        expect(historical.validatorCount).toBe(finalizedValidatorCount + 1);
        expect(pubkeyCache.size).toBe(finalizedValidatorCount);
        expect(pubkeyCache.getIndex(pubkey)).toBeNull();
        expect(pubkeyCache.getCandidates(pubkey)).toEqual([finalizedValidatorCount]);
      } finally {
        historical?.release();
        anchor.release();
      }
    }
  );

  it("loads and rotates sync committees from a trusted validator registry", () => {
    const config = createBeaconConfig(getConfig(ForkName.fulu), genesisRoot);
    const targetSlot = EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
    const state = createFuluState(config, targetSlot - SLOTS_PER_EPOCH);
    pubkeyCache.syncPubkeys(state.validators.getAllReadonlyValues());
    const native = createBeaconStateViewForHistoricalRegen({
      nativeStateTransition: true,
      config,
      stateBytes: state.serialize(),
    });
    let postState: IBeaconStateView | undefined;
    try {
      expect(native).toBeInstanceOf(NativeBeaconStateView);
      if (!(native instanceof NativeBeaconStateView)) throw Error("Expected native state view");
      expect([...native.currentSyncCommitteeValidatorIndices]).toEqual(
        Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => i % finalizedValidatorCount)
      );
      expect(pubkeyCache.size).toBe(finalizedValidatorCount);
      postState = native.processSlots(targetSlot);
      expect(postState.slot).toBe(targetSlot);
      expect(postState.validatorCount).toBe(finalizedValidatorCount);
      expect(pubkeyCache.size).toBe(finalizedValidatorCount);
    } finally {
      postState?.release();
      native.release();
    }
  });
});
