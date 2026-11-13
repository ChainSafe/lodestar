import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  BUILDER_WITHDRAWAL_PREFIX,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  ForkName,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {getValidatorIndex} from "../../../src/cache/pubkeyCache.js";
import {IBeaconStateView} from "../../../src/stateView/interface.js";
import {NativeBeaconStateView} from "../../../src/stateView/nativeBeaconStateView.js";
import {
  createBeaconStateView,
  createBeaconStateViewForHistoricalRegen,
} from "../../../src/stateView/stateViewFactory.js";
import {
  addPubkeyCacheDeposits,
  createPubkeyCacheFuluState,
  finalizedValidatorCount,
  pubkeyCacheForkEpoch,
  pubkeyCacheGenesisRoot,
  pubkeyCacheKeyA,
  pubkeyCacheKeyB,
  slashPubkeyCacheFirstValidator,
} from "../../utils/pubkeyCache.js";

describe("NativeBeaconStateView validator pubkey cache branches", () => {
  beforeEach(() => {
    pubkeyCache.reset();
    pubkeyCache.ensureCapacity(4096);
  });

  it.each(["side first", "canonical first"] as const)("keeps Gloas branch indices independent: %s", (order) => {
    const config = createBeaconConfig(getConfig(ForkName.gloas, pubkeyCacheForkEpoch), pubkeyCacheGenesisRoot);
    const forkSlot = pubkeyCacheForkEpoch * SLOTS_PER_EPOCH;
    const base = createPubkeyCacheFuluState(config, forkSlot - SLOTS_PER_EPOCH);
    const churn = Math.min(config.MAX_PER_EPOCH_ACTIVATION_EXIT_CHURN_LIMIT, config.MIN_PER_EPOCH_CHURN_LIMIT_ELECTRA);
    addPubkeyCacheDeposits(base, config, churn, BUILDER_WITHDRAWAL_PREFIX);
    base.commit();
    const baseBytes = base.serialize();
    const sideState = base.clone();
    slashPubkeyCacheFirstValidator(sideState);
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
      const {side, canonical} =
        order === "side first"
          ? {
              side: processBranch(sideBytes, forkSlot),
              canonical: processBranch(baseBytes, forkSlot + SLOTS_PER_EPOCH),
            }
          : {
              canonical: processBranch(baseBytes, forkSlot + SLOTS_PER_EPOCH),
              side: processBranch(sideBytes, forkSlot),
            };
      const pubkeyA = pubkeyCacheKeyA.toPublicKey().toBytes();
      const pubkeyB = pubkeyCacheKeyB.toPublicKey().toBytes();
      expect(side.validatorCount).toBe(finalizedValidatorCount + 2);
      expect(canonical.validatorCount).toBe(finalizedValidatorCount + 1);
      expect(getValidatorIndex(side, pubkeyA, pubkeyCache)).toBe(finalizedValidatorCount);
      expect(getValidatorIndex(side, pubkeyB, pubkeyCache)).toBe(finalizedValidatorCount + 1);
      expect(getValidatorIndex(canonical, pubkeyA, pubkeyCache)).toBeNull();
      expect(getValidatorIndex(canonical, pubkeyB, pubkeyCache)).toBe(finalizedValidatorCount);
      expect(canonical.getValidator(finalizedValidatorCount).pubkey).toEqual(pubkeyB);
      expect(pubkeyCache.size).toBe(finalizedValidatorCount);
      expect(pubkeyCache.getIndex(pubkeyA)).toBeNull();
      expect(pubkeyCache.getIndex(pubkeyB)).toBeNull();
    } finally {
      for (const view of views) view.release();
    }
  });

  it("loads and rotates sync committees with active validators beyond the finalized cache", () => {
    const config = createBeaconConfig(getConfig(ForkName.fulu), pubkeyCacheGenesisRoot);
    const targetSlot = EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;
    const state = createPubkeyCacheFuluState(config, targetSlot - SLOTS_PER_EPOCH);
    pubkeyCache.append(0, state.validators.getReadonly(0).pubkey);
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
      expect(pubkeyCache.size).toBe(1);
      postState = native.processSlots(targetSlot);
      expect(postState.slot).toBe(targetSlot);
      expect(postState.validatorCount).toBe(finalizedValidatorCount);
      expect(pubkeyCache.size).toBe(1);
    } finally {
      postState?.release();
      native.release();
    }
  });
});
