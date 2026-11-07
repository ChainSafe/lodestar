import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import type bindings from "../src/index.js";
import {init, scrapeMetrics} from "../src/metrics.js";
import {createNative, signedDeposit} from "./depositCacheFixture.js";

describe("native pre-Gloas deposit signature cache", () => {
  it("warms the adversarial prefix even when a valid same-key validator deposit follows the builder", () => {
    init();
    const builder = signedDeposit(91);
    const validator = signedDeposit(91, 1);
    const invalid = Array.from({length: 40}, (_, index) => ({...validator, amount: validator.amount + index + 1}));
    const {state} = createNative([...invalid, builder, validator]);
    const {state: coldSource} = createNative([...invalid, builder, validator]);
    const before = state.hashTreeRoot();
    let cold: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let warm: InstanceType<typeof bindings.BeaconStateView> | undefined;
    try {
      cold = coldSource.processSlots(coldSource.slot + 1, {dontTransferCache: true});
      expect(scrapeMetrics()).toContain('stfn_gloas_onboard_builders_signature_checks{source="verified"} 41\n');
      const first = state.preVerifyBuilderDepositsPreGloas(10_000, 60_000);
      expect(first.invalidValidatorSignaturesCount).toBe(40);
      expect(first.validBuilderSignaturesCount).toBe(1);
      expect(first.validValidatorSignaturesCount).toBe(1);
      const second = state.preVerifyBuilderDepositsPreGloas(10_000, 60_000);
      expect(second.invalidValidatorSignaturesCount).toBe(0);
      expect(second.totalCachedDeposits).toBe(42);
      expect(second.totalBuilderPubkeys).toBe(1);
      expect(state.hashTreeRoot()).toEqual(before);

      warm = state.processSlots(state.slot + 1, {dontTransferCache: true});
      expect(warm.hashTreeRoot()).toEqual(cold.hashTreeRoot());
      expect(warm.getBuildersLength()).toBe(1);
      expect(warm.getBuilder(0).balance).toBe(builder.amount + validator.amount);
      expect(warm.pendingDepositsCount).toBe(40);
      expect(scrapeMetrics()).toContain('stfn_gloas_onboard_builders_signature_checks{source="verified"} 0\n');
      expect(scrapeMetrics()).toContain('stfn_gloas_onboard_builders_signature_checks{source="cache"} 41\n');
      warm.clearPreGloasBuilderDepositCache();
      expect(state.preVerifyBuilderDepositsPreGloas(0, 0).totalCachedDeposits).toBe(0);
    } finally {
      cold?.release();
      warm?.release();
      coldSource.release();
      state.release();
    }
  });

  it("shares results with reloaded states while separating altered signatures and changed queue order", () => {
    const builder = signedDeposit(92);
    const {state, value, bytes} = createNative([builder]);
    let reloaded: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let reorg: InstanceType<typeof bindings.BeaconStateView> | undefined;
    try {
      expect(state.preVerifyBuilderDepositsPreGloas(1, 60_000).validBuilderSignaturesCount).toBe(1);
      reloaded = state.loadOtherState(bytes);
      state.release();
      expect(reloaded.preVerifyBuilderDepositsPreGloas(1, 60_000).validBuilderSignaturesCount).toBe(0);
      value.pendingDeposits = [{...builder, signature: new Uint8Array(96)}, builder];
      reorg = reloaded.loadOtherState(ssz.fulu.BeaconState.serialize(value));
      const result = reorg.preVerifyBuilderDepositsPreGloas(10_000, 60_000);
      expect(result.invalidBuilderSignaturesCount).toBe(1);
      expect(result.validBuilderSignaturesCount).toBe(0);
      expect(result.totalCachedDeposits).toBe(2);
      reorg.clearPreGloasBuilderDepositCache();
      expect(reloaded.preVerifyBuilderDepositsPreGloas(0, 0).totalCachedDeposits).toBe(0);
    } finally {
      state.release();
      reloaded?.release();
      reorg?.release();
    }
  });

  it("bounds zero-budget scans and validates JavaScript-controlled limits", () => {
    const {state} = createNative(Array.from({length: 100}, () => ssz.electra.PendingDeposit.defaultValue()));
    try {
      const result = state.preVerifyBuilderDepositsPreGloas(10_000, 0);
      expect(result.scannedPendingDeposits).toBe(32);
      expect(result.totalCachedDeposits).toBe(1);
      expect(state.preVerifyBuilderDepositsPreGloas(0, 60_000).scannedPendingDeposits).toBe(0);
      for (const limit of [-1, 0.5, NaN, Infinity, 10_001, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => state.preVerifyBuilderDepositsPreGloas(limit, 1), `verification limit ${limit}`).toThrow(
          "InvalidDepositVerificationLimit"
        );
      }
      for (const duration of [-1, 0.5, NaN, Infinity, 60_001, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => state.preVerifyBuilderDepositsPreGloas(1, duration), `duration ${duration}`).toThrow(
          "InvalidDepositVerificationDuration"
        );
      }
      state.release();
      expect(() => state.preVerifyBuilderDepositsPreGloas(1, 1)).toThrow("InvalidState");
      expect(() => state.clearPreGloasBuilderDepositCache()).toThrow("InvalidState");
    } finally {
      state.release();
    }
  });
});
