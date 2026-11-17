import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, GENESIS_SLOT} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateBuilderPendingDeposits, generateValidatorPendingDeposit} from "../../../src/testUtils/util.js";
import {CachedBeaconStateFulu} from "../../../src/types.js";
import {
  BUILDER_DEPOSIT_BATCH_SIZE,
  MAX_BUILDER_DEPOSITS_PER_SLOT,
  preVerifyBuilderDepositsPreGloas,
} from "../../../src/util/preVerifyBuilderDeposits.js";

// Generous wall-clock budget so tests that aren't exercising the time-box verify everything in one call.
const NO_TIME_LIMIT_MS = 60_000;

const chainConfig = getConfig(ForkName.fulu);
const beaconConfig = createBeaconConfig(chainConfig, Buffer.alloc(32));

/** A validator (non-builder) pending deposit — BLS withdrawal prefix (0x00), so not builder-routed. */
function validatorPendingDeposit(pubkeySeed: number): electra.PendingDeposit {
  return {
    pubkey: Buffer.alloc(48, pubkeySeed),
    withdrawalCredentials: Buffer.alloc(32), // 0x00 prefix → not a builder
    amount: 32_000_000_000,
    signature: Buffer.alloc(96, 1),
    slot: GENESIS_SLOT,
  };
}

function withInvalidSignature(deposit: electra.PendingDeposit): electra.PendingDeposit {
  return {...deposit, signature: Buffer.alloc(96)};
}

/** Build a Fulu state whose pendingDeposits contains exactly `deposits` (in order). */
function buildFuluStateWithPendingDeposits(
  deposits: electra.PendingDeposit[],
  validatorPubkeys: Uint8Array[] = []
): CachedBeaconStateFulu {
  const stateView = ssz.fulu.BeaconState.defaultViewDU();
  for (const pubkey of validatorPubkeys) {
    const validator = ssz.phase0.Validator.defaultValue();
    validator.pubkey = pubkey;
    validator.effectiveBalance = 32_000_000_000;
    stateView.validators.push(ssz.phase0.Validator.toViewDU(validator));
    stateView.balances.push(32_000_000_000);
  }
  for (const deposit of deposits) {
    stateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
  stateView.commit();
  const state = createCachedBeaconStateTest(stateView, chainConfig, {
    skipSyncCommitteeCache: true,
    skipSyncPubkeys: validatorPubkeys.length === 0,
  });
  state.commit();
  return state as CachedBeaconStateFulu;
}

describe("preVerifyBuilderDepositsPreGloas", () => {
  it("caches only builder-prefix deposits, keyed by value-object identity (valid → true, invalid → false)", () => {
    const [validBuilder0, validBuilder1] = generateBuilderPendingDeposits(beaconConfig, 2, 1000);
    const invalidBuilder = withInvalidSignature(generateBuilderPendingDeposits(beaconConfig, 1, 2000)[0]);
    const validator = validatorPendingDeposit(7);

    const state = buildFuluStateWithPendingDeposits([validBuilder0, validator, validBuilder1, invalidBuilder]);
    const cache = state.epochCtx.builderDepositSignatureCache;
    const [dValidBuilder0, dValidator, dValidBuilder1, dInvalidBuilder] = state.pendingDeposits.getAllReadonlyValues();

    const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);

    expect(result).toEqual({
      validBuilderSignaturesCount: 2,
      invalidBuilderSignaturesCount: 1,
      validValidatorSignaturesCount: 0,
      invalidValidatorSignaturesCount: 0,
      scannedPendingDeposits: 4,
      totalCachedDeposits: 3,
      totalBuilderPubkeys: 1,
      pendingDepositsCount: 4,
    });
    // builder deposits cached by validity
    expect(cache.getSignatureValidity(dValidBuilder0)).toBe(true);
    expect(cache.getSignatureValidity(dValidBuilder1)).toBe(true);
    expect(cache.getSignatureValidity(dInvalidBuilder)).toBe(false);
    // validator deposit never touched
    expect(cache.getSignatureValidity(dValidator)).toBeNull();
    expect(cache.isVerified(dValidator)).toBe(false);
    expect(cache.cachedDepositCount).toBe(3);
  });

  it("skips already-cached deposits on a second call (no re-verify)", () => {
    const state = buildFuluStateWithPendingDeposits(generateBuilderPendingDeposits(beaconConfig, 3, 3000));

    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(first.validBuilderSignaturesCount).toBe(3);
    expect(first.totalCachedDeposits).toBe(3);

    // second call: all 3 already cached → nothing new verified, cache unchanged
    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(second.validBuilderSignaturesCount).toBe(0);
    expect(second.invalidBuilderSignaturesCount).toBe(0);
    expect(second.scannedPendingDeposits).toBe(3);
    expect(second.totalCachedDeposits).toBe(3);
    expect(second.pendingDepositsCount).toBe(3);
  });

  it("caps new verifications at maxBuilderDeposits and resumes on the next call", () => {
    const state = buildFuluStateWithPendingDeposits(generateBuilderPendingDeposits(beaconConfig, 3, 4000));

    // cap = 2: queue 2, break before scanning the 3rd
    const first = preVerifyBuilderDepositsPreGloas(state, 2, NO_TIME_LIMIT_MS);
    expect(first.validBuilderSignaturesCount).toBe(2);
    expect(first.scannedPendingDeposits).toBe(2);
    expect(first.pendingDepositsCount).toBe(3);
    expect(first.scannedPendingDeposits).toBeLessThan(first.pendingDepositsCount); // cap hit

    // next call resumes past the 2 cached, verifies the 3rd, scans to the end
    const second = preVerifyBuilderDepositsPreGloas(state, 2, NO_TIME_LIMIT_MS);
    expect(second.validBuilderSignaturesCount).toBe(1);
    expect(second.scannedPendingDeposits).toBe(3);
    expect(second.scannedPendingDeposits).toBe(second.pendingDepositsCount); // scanned to the end
    expect(second.totalCachedDeposits).toBe(3);
  });

  it("time-boxes verification per batch and resumes on the next call", () => {
    // maxDurationMs = 0 → after each verified batch, `Date.now() >= Date.now() + 0` is always true,
    // so exactly one BUILDER_DEPOSIT_BATCH_SIZE batch is verified per call, deterministically.
    const total = BUILDER_DEPOSIT_BATCH_SIZE + 5;
    const state = buildFuluStateWithPendingDeposits(generateBuilderPendingDeposits(beaconConfig, total, 5000));

    // first call: one full batch, then time-box out (count cap is generous, so time is the bound)
    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, 0);
    expect(first.validBuilderSignaturesCount).toBe(BUILDER_DEPOSIT_BATCH_SIZE);
    expect(first.invalidBuilderSignaturesCount).toBe(0);
    expect(first.totalCachedDeposits).toBe(BUILDER_DEPOSIT_BATCH_SIZE); // < total ⇒ timed out

    // second call resumes past the cached batch and finishes the remaining 5
    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, 0);
    expect(second.validBuilderSignaturesCount).toBe(5);
    expect(second.totalCachedDeposits).toBe(total);
  });

  it("pre-verifies validator deposits sharing an invalid builder deposit's pubkey (discovered one tick, verified the next)", () => {
    const builder = withInvalidSignature(generateBuilderPendingDeposits(beaconConfig, 1, 6000)[0]);
    // a validator (0x00) deposit for the SAME pubkey as the builder deposit, with an invalid sig
    const validatorForBuilder: electra.PendingDeposit = {
      pubkey: builder.pubkey,
      withdrawalCredentials: Buffer.alloc(32),
      amount: 32_000_000_000,
      signature: Buffer.alloc(96),
      slot: GENESIS_SLOT,
    };
    // the validator deposit precedes the builder deposit — the Scenario-5 ordering
    const state = buildFuluStateWithPendingDeposits([validatorForBuilder, builder]);
    const cache = state.epochCtx.builderDepositSignatureCache;
    const [dValidator, dBuilder] = state.pendingDeposits.getAllReadonlyValues();

    // tick 1: verifies the builder deposit (invalid) and marks its pubkey; the validator deposit
    // was scanned before the builder deposit, so it isn't queued yet.
    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(first.invalidBuilderSignaturesCount).toBe(1);
    expect(cache.getSignatureValidity(dBuilder)).toBe(false);
    expect(cache.isBuilderPubkey(toPubkeyHex(builder.pubkey))).toBe(true);
    expect(cache.getSignatureValidity(dValidator)).toBeNull(); // not verified yet

    // tick 2: the validator deposit now matches a known builder pubkey → verified (invalid) and cached
    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(second.invalidValidatorSignaturesCount).toBe(1);
    expect(cache.getSignatureValidity(dValidator)).toBe(false);
  });

  it("stops pre-verifying a builder pubkey's validator deposits once one is cached valid", () => {
    const builder = withInvalidSignature(generateBuilderPendingDeposits(beaconConfig, 1, 7000)[0]);
    // two validator (0x00) deposits for the SAME pubkey as the builder deposit; both validly signed.
    // Distinct amounts make them distinct deposit value objects (distinct cache keys).
    const validatorValid = generateValidatorPendingDeposit(beaconConfig, 7000, 32_000_000_000);
    const validatorSecond = generateValidatorPendingDeposit(beaconConfig, 7000, 31_000_000_000);

    const state = buildFuluStateWithPendingDeposits([builder, validatorValid, validatorSecond]);
    const cache = state.epochCtx.builderDepositSignatureCache;
    const [, dValid, dSecond] = state.pendingDeposits.getAllReadonlyValues();

    // tick 1: verifies the builder deposit (invalid) and marks its pubkey; the validator deposits
    // are not queued yet since the pubkey is only marked after verification.
    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(first.invalidBuilderSignaturesCount).toBe(1);
    expect(first.validValidatorSignaturesCount).toBe(0);

    // tick 2 (cap 1): verifies only validatorValid → pubkey marked as having a valid validator deposit
    const second = preVerifyBuilderDepositsPreGloas(state, 1, NO_TIME_LIMIT_MS);
    expect(second.validValidatorSignaturesCount).toBe(1);
    expect(cache.getSignatureValidity(dValid)).toBe(true);
    expect(cache.hasValidValidatorDeposit(toPubkeyHex(builder.pubkey))).toBe(true);

    // tick 3: validatorSecond shares the pubkey, but a valid validator deposit is already cached, so
    // it is never queued/verified — mirroring hasPendingValidator's first-valid short-circuit.
    const third = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(third.validValidatorSignaturesCount).toBe(0);
    expect(third.invalidValidatorSignaturesCount).toBe(0);
    expect(cache.getSignatureValidity(dSecond)).toBeNull(); // skipped, never verified
    expect(cache.isVerified(dSecond)).toBe(false);
  });

  it("does not pre-verify validator deposits sharing a valid builder deposit's pubkey", () => {
    const [builder] = generateBuilderPendingDeposits(beaconConfig, 1, 8000);
    const validatorForBuilder: electra.PendingDeposit = {
      pubkey: builder.pubkey,
      withdrawalCredentials: Buffer.alloc(32),
      amount: 32_000_000_000,
      signature: Buffer.alloc(96),
      slot: GENESIS_SLOT,
    };
    const state = buildFuluStateWithPendingDeposits([validatorForBuilder, builder]);
    const cache = state.epochCtx.builderDepositSignatureCache;
    const [dValidator] = state.pendingDeposits.getAllReadonlyValues();

    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(first.validBuilderSignaturesCount).toBe(1);
    // a valid builder deposit registers the builder at the fork without consulting hasPendingValidator
    expect(cache.isBuilderPubkey(toPubkeyHex(builder.pubkey))).toBe(false);

    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(second.validValidatorSignaturesCount + second.invalidValidatorSignaturesCount).toBe(0);
    expect(cache.isVerified(dValidator)).toBe(false);
    expect(second.totalBuilderPubkeys).toBe(0);
  });

  it("does not pre-verify validator deposits for an invalid builder deposit on an existing validator's pubkey", () => {
    const builder = withInvalidSignature(generateBuilderPendingDeposits(beaconConfig, 1, 9000)[0]);
    const validatorForBuilder: electra.PendingDeposit = {
      pubkey: builder.pubkey,
      withdrawalCredentials: Buffer.alloc(32),
      amount: 32_000_000_000,
      signature: Buffer.alloc(96),
      slot: GENESIS_SLOT,
    };
    // the pubkey already has a validator, so the fork keeps the invalid builder deposit as a top-up
    // without walking the same-pubkey validator deposits
    const state = buildFuluStateWithPendingDeposits([validatorForBuilder, builder], [builder.pubkey]);
    const cache = state.epochCtx.builderDepositSignatureCache;
    const [dValidator] = state.pendingDeposits.getAllReadonlyValues();

    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(first.invalidBuilderSignaturesCount).toBe(1);
    expect(cache.isBuilderPubkey(toPubkeyHex(builder.pubkey))).toBe(false);

    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT, NO_TIME_LIMIT_MS);
    expect(second.validValidatorSignaturesCount + second.invalidValidatorSignaturesCount).toBe(0);
    expect(cache.isVerified(dValidator)).toBe(false);
  });
});
