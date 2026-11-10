import {ssz} from "@lodestar/types";
import {beforeAll, describe, expect, it} from "vitest";
import type bindings from "../src/index.js";
import {init, scrapeMetrics} from "../src/metrics.js";
import {createNative, signedDeposit} from "./depositCacheFixture.js";

describe("native pre-Gloas deposit signature cache", () => {
  beforeAll(init);

  it("warms the adversarial prefix even when a valid same-key validator deposit follows the builder", () => {
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
      expect(first.invalidValidatorSignaturesCount).toBe(0);
      expect(first.validBuilderSignaturesCount).toBe(1);
      expect(first.validValidatorSignaturesCount).toBe(1);
      const second = state.preVerifyBuilderDepositsPreGloas(10_000, 60_000);
      expect(second.invalidValidatorSignaturesCount).toBe(40);
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

  it("discovers a builder before warming its earlier validator deposit across an unrelated queue end", () => {
    const builder = signedDeposit(108);
    const validator = signedDeposit(108, 1);
    const unrelated = Array.from({length: 40}, (_, index) => signedDeposit(200 + index, 1));
    const {state} = createNative([...unrelated, validator, builder, unrelated[0]]);
    try {
      const before = state.hashTreeRoot();
      const first = state.preVerifyBuilderDepositsPreGloas(1, 60_000);
      expect(first.validBuilderSignaturesCount).toBe(1);
      expect(first.validValidatorSignaturesCount).toBe(0);
      expect(first.totalCachedDeposits).toBe(1);
      const second = state.preVerifyBuilderDepositsPreGloas(1, 60_000);
      expect(second.validBuilderSignaturesCount).toBe(0);
      expect(second.validValidatorSignaturesCount).toBe(1);
      expect(second.totalCachedDeposits).toBe(2);
      expect(state.hashTreeRoot()).toEqual(before);
    } finally {
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

  it.each(["reordered", "compacted"])("preserves warm/cold fork parity after a %s queue change", (change) => {
    const original = Array.from({length: 4}, (_, index) => signedDeposit(101 + index));
    const altered = {...original[0], signature: new Uint8Array(96)};
    const deposits = [altered, ...(change === "reordered" ? original.slice(1).reverse() : original.slice(3))];
    const {state, value} = createNative(original);
    const {state: coldSource} = createNative(deposits);
    let reloaded: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let cold: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let warm: InstanceType<typeof bindings.BeaconStateView> | undefined;
    try {
      expect(state.preVerifyBuilderDepositsPreGloas(1, 60_000).validBuilderSignaturesCount).toBe(1);
      value.pendingDeposits = deposits;
      reloaded = state.loadOtherState(ssz.fulu.BeaconState.serialize(value));
      const before = reloaded.hashTreeRoot();
      const resumed = reloaded.preVerifyBuilderDepositsPreGloas(1, 60_000);
      expect(resumed.scannedPendingDeposits).toBe(1);
      expect(resumed.validBuilderSignaturesCount).toBe(1);
      expect(resumed.invalidBuilderSignaturesCount).toBe(0);
      expect(resumed.totalCachedDeposits).toBe(2);
      expect(reloaded.hashTreeRoot()).toEqual(before);

      cold = coldSource.processSlots(coldSource.slot + 1, {dontTransferCache: true});
      expect(scrapeMetrics()).toContain(
        `stfn_gloas_onboard_builders_signature_checks{source="verified"} ${deposits.length}\n`
      );
      warm = reloaded.processSlots(reloaded.slot + 1, {dontTransferCache: true});
      expect(warm.hashTreeRoot()).toEqual(cold.hashTreeRoot());
      expect(scrapeMetrics()).toContain(
        `stfn_gloas_onboard_builders_signature_checks{source="verified"} ${deposits.length - 1}\n`
      );
      expect(scrapeMetrics()).toContain('stfn_gloas_onboard_builders_signature_checks{source="cache"} 1\n');
      const actual = ssz.gloas.BeaconState.deserialize(warm.serialize());
      const expected = ssz.gloas.BeaconState.deserialize(cold.serialize());
      expect(actual.builders).toEqual(expected.builders);
      expect(actual.builders).toHaveLength(deposits.length - 1);
      expect(actual.pendingDeposits).toEqual(expected.pendingDeposits);
      expect(actual.pendingDeposits).toHaveLength(0);
    } finally {
      warm?.release();
      cold?.release();
      reloaded?.release();
      coldSource.release();
      state.release();
    }
  });

  it("revisits a replacement before the saved cursor after wrapping", () => {
    const original = [signedDeposit(105), signedDeposit(106)];
    const replacement = signedDeposit(107);
    const {state, value} = createNative(original);
    let reloaded: InstanceType<typeof bindings.BeaconStateView> | undefined;
    try {
      state.preVerifyBuilderDepositsPreGloas(1, 60_000);
      value.pendingDeposits = [replacement, original[1]];
      reloaded = state.loadOtherState(ssz.fulu.BeaconState.serialize(value));
      const beforeWrap = reloaded.preVerifyBuilderDepositsPreGloas(1, 60_000);
      expect(beforeWrap.validBuilderSignaturesCount).toBe(1);
      expect(beforeWrap.totalCachedDeposits).toBe(2);
      const afterWrap = reloaded.preVerifyBuilderDepositsPreGloas(1, 60_000);
      expect(afterWrap.validBuilderSignaturesCount).toBe(1);
      expect(afterWrap.totalCachedDeposits).toBe(3);
      expect(reloaded.preVerifyBuilderDepositsPreGloas(1, 60_000).validBuilderSignaturesCount).toBe(0);
    } finally {
      reloaded?.release();
      state.release();
    }
  });

  it("bounds zero-budget scans and validates JavaScript-controlled limits", () => {
    const {state} = createNative(Array.from({length: 100}, () => ssz.electra.PendingDeposit.defaultValue()));
    try {
      const result = state.preVerifyBuilderDepositsPreGloas(10_000, 0);
      expect(result.scannedPendingDeposits).toBe(32);
      expect(result.totalCachedDeposits).toBe(0);
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
