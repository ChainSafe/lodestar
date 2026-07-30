import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, GENESIS_SLOT} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";
import {CachedBeaconStateFulu} from "../../../src/types.js";
import {
  MAX_BUILDER_DEPOSITS_PER_SLOT,
  preVerifyBuilderDepositsPreGloas,
} from "../../../src/util/preVerifyBuilderDeposits.js";

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
function buildFuluStateWithPendingDeposits(deposits: electra.PendingDeposit[]): CachedBeaconStateFulu {
  const stateView = ssz.fulu.BeaconState.defaultViewDU();
  for (const deposit of deposits) {
    stateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
  const state = createCachedBeaconStateTest(stateView, chainConfig, {
    skipSyncCommitteeCache: true,
    skipSyncPubkeys: true,
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

    const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);

    expect(result).toEqual({
      verifiedBuildersCount: 2,
      invalidBuildersCount: 1,
      scannedPendingDeposits: 4,
      totalBuildersVerified: 3,
      pendingDepositsCount: 4,
    });
    // builder deposits cached by validity
    expect(cache.getSignatureValidity(dValidBuilder0)).toBe(true);
    expect(cache.getSignatureValidity(dValidBuilder1)).toBe(true);
    expect(cache.getSignatureValidity(dInvalidBuilder)).toBe(false);
    // validator deposit never touched
    expect(cache.getSignatureValidity(dValidator)).toBeNull();
    expect(cache.isVerified(dValidator)).toBe(false);
    expect(cache.size).toBe(3);
  });

  it("skips already-cached deposits on a second call (no re-verify)", () => {
    const state = buildFuluStateWithPendingDeposits(generateBuilderPendingDeposits(beaconConfig, 3, 3000));

    const first = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);
    expect(first.verifiedBuildersCount).toBe(3);
    expect(first.totalBuildersVerified).toBe(3);

    // second call: all 3 already cached → nothing new verified, cache unchanged
    const second = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);
    expect(second.verifiedBuildersCount).toBe(0);
    expect(second.invalidBuildersCount).toBe(0);
    expect(second.scannedPendingDeposits).toBe(3);
    expect(second.totalBuildersVerified).toBe(3);
    expect(second.pendingDepositsCount).toBe(3);
  });

  it("caps new verifications at maxBuilderDeposits and resumes on the next call", () => {
    const state = buildFuluStateWithPendingDeposits(generateBuilderPendingDeposits(beaconConfig, 3, 4000));

    // cap = 2: queue 2, break before scanning the 3rd
    const first = preVerifyBuilderDepositsPreGloas(state, 2);
    expect(first.verifiedBuildersCount).toBe(2);
    expect(first.scannedPendingDeposits).toBe(2);
    expect(first.pendingDepositsCount).toBe(3);
    expect(first.scannedPendingDeposits).toBeLessThan(first.pendingDepositsCount); // cap hit

    // next call resumes past the 2 cached, verifies the 3rd, scans to the end
    const second = preVerifyBuilderDepositsPreGloas(state, 2);
    expect(second.verifiedBuildersCount).toBe(1);
    expect(second.scannedPendingDeposits).toBe(3);
    expect(second.scannedPendingDeposits).toBe(second.pendingDepositsCount); // scanned to the end
    expect(second.totalBuildersVerified).toBe(3);
  });
});
