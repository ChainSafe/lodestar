import {describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import type {CachedBeaconStateFulu} from "../../../src/types.js";

// Spy on isValidDepositSignature (the fork-transition fallback + the pendingDepositsLookup path) so
// we can assert exactly how many times onboardBuildersFromPendingDeposits falls back to per-deposit
// verification instead of using the pre-verified cache.
const isValidDepositSignatureSpy = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../../src/block/processDeposit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/block/processDeposit.js")>();
  return {...actual, isValidDepositSignature: isValidDepositSignatureSpy};
});

const {createCachedBeaconState} = await import("../../../src/cache/stateCache.js");
const {upgradeStateToGloas} = await import("../../../src/slot/upgradeStateToGloas.js");
const {generateBuilderPendingDeposits} = await import("../../../src/testUtils/util.js");
const {preVerifyBuilderDepositsPreGloas, MAX_BUILDER_DEPOSITS_PER_SLOT} = await import(
  "../../../src/util/preVerifyBuilderDeposits.js"
);

const config = createBeaconConfig(getConfig(ForkName.fulu), Buffer.alloc(32));

// Shared test data: 4 validly-signed builder deposits (distinct interop pubkeys).
const builderDeposits = generateBuilderPendingDeposits(config, 4, 1000);

/** Build a fresh Fulu state with active validators + the shared builder deposits pending. */
function buildFuluState(): CachedBeaconStateFulu {
  const stateView = ssz.fulu.BeaconState.defaultViewDU();
  // Some active validators so shuffling / PTC-window init have a non-empty set.
  for (let i = 0; i < 64; i++) {
    const validator = ssz.phase0.Validator.defaultValue();
    validator.pubkey = Buffer.alloc(48, i + 1);
    validator.withdrawalCredentials = Buffer.alloc(32, i + 1);
    validator.effectiveBalance = 32e9;
    validator.activationEligibilityEpoch = 0;
    validator.activationEpoch = 0;
    validator.exitEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
    stateView.validators.push(ssz.phase0.Validator.toViewDU(validator));
    stateView.balances.push(32e9);
  }
  for (const deposit of builderDeposits) {
    stateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
  stateView.commit();
  return createCachedBeaconState(
    stateView,
    {config, pubkeyCache},
    {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
  ) as CachedBeaconStateFulu;
}

describe("upgradeStateToGloas - builder-deposit signature cache", () => {
  // Case 1 proves the spy genuinely observes a fallback (cache miss → called once), which makes
  // Case 2's "never called" assertion trustworthy (fully warm cache → the isValidDepositSignature
  // fallback in onboardBuildersFromPendingDeposits is skipped entirely).
  const cases = [
    {name: "falls back to isValidDepositSignature for an uncached deposit", cachedCount: 3, expectedFallbackCalls: 1},
    {
      name: "never calls isValidDepositSignature when every deposit is cached",
      cachedCount: 4,
      expectedFallbackCalls: 0,
    },
  ];

  for (const {name, cachedCount, expectedFallbackCalls} of cases) {
    it(name, () => {
      isValidDepositSignatureSpy.mockClear();
      const fuluState = buildFuluState();

      // Pre-verify the first `cachedCount` builder deposits by value-object identity (all valid).
      const cache = fuluState.epochCtx.builderDepositSignatureCache;
      const values = fuluState.pendingDeposits.getAllReadonlyValues();
      for (let i = 0; i < cachedCount; i++) {
        cache.setSignatureValidity(values[i], true);
      }

      const gloasState = upgradeStateToGloas(fuluState);

      // Fallback runs exactly once per uncached deposit (0 when fully warm).
      expect(isValidDepositSignatureSpy).toHaveBeenCalledTimes(expectedFallbackCalls);
      // All 4 valid deposits onboarded either way (cache hit OR fallback), pending queue drained.
      expect(gloasState.builders.length).toBe(builderDeposits.length);
      expect(gloasState.pendingDeposits.length).toBe(0);
    });
  }

  it("Scenario 5: fork resolves same-pubkey validator deposits from the cache (no BLS fallback)", () => {
    isValidDepositSignatureSpy.mockClear();

    const [builder] = generateBuilderPendingDeposits(config, 1, 2000);
    // Many invalid 0x01 validator deposits, all targeting the builder's pubkey (each a distinct
    // object). At the fork, hasPendingValidator(P) walks these — the unbounded-BLS DoS this guards.
    const validatorsForBuilder = Array.from({length: 40}, () => ({
      pubkey: builder.pubkey,
      withdrawalCredentials: Buffer.alloc(32), // 0x00 → validator, not builder-routed
      amount: 32_000_000_000,
      signature: Buffer.alloc(96), // invalid (fails to parse)
      slot: 0,
    }));

    const fuluStateView = ssz.fulu.BeaconState.defaultViewDU();
    for (let i = 0; i < 64; i++) {
      const validator = ssz.phase0.Validator.defaultValue();
      validator.pubkey = Buffer.alloc(48, i + 1);
      validator.withdrawalCredentials = Buffer.alloc(32, i + 1);
      validator.effectiveBalance = 32e9;
      validator.activationEligibilityEpoch = 0;
      validator.activationEpoch = 0;
      validator.exitEpoch = FAR_FUTURE_EPOCH;
      validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
      fuluStateView.validators.push(ssz.phase0.Validator.toViewDU(validator));
      fuluStateView.balances.push(32e9);
    }
    for (const deposit of validatorsForBuilder) {
      fuluStateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
    }
    fuluStateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(builder)); // builder LAST
    fuluStateView.commit();

    const fuluState = createCachedBeaconState(
      fuluStateView,
      {config, pubkeyCache},
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateFulu;

    // Warm the cache like prepareNextSlot would: tick 1 discovers the builder pubkey + verifies the
    // builder deposit; tick 2 pre-verifies the same-pubkey validator deposits.
    preVerifyBuilderDepositsPreGloas(fuluState, MAX_BUILDER_DEPOSITS_PER_SLOT, 60_000);
    preVerifyBuilderDepositsPreGloas(fuluState, MAX_BUILDER_DEPOSITS_PER_SLOT, 60_000);

    const gloasState = upgradeStateToGloas(fuluState);

    // The builder onboards; hasPendingValidator resolved all 40 validator checks from the cache, so
    // isValidDepositSignature (the BLS fallback) is never called on the transition's critical path.
    expect(gloasState.builders.length).toBe(1);
    expect(isValidDepositSignatureSpy).not.toHaveBeenCalled();
  });
});
