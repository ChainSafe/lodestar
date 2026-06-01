import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, ForkSeq} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {processDepositRequest} from "../../../src/block/processDepositRequest.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";

/**
 * Targeted coverage of the cache fast-path inside processDepositRequest:
 * when builderDepositSignatureCache (keyed by state.latestExecutionPayloadBid.blockHash)
 * already contains a verified deposit, the path bypasses BLS verification entirely
 * and onboards the builder directly. We prove the fast path is taken by seeding the
 * cache with a deposit whose signature is *invalid* — the only way an invalid-sig
 * deposit can result in a builder being added is if verification was skipped.
 */
describe("processDepositRequest — Gloas cache fast path", () => {
  const chainConfig = getConfig(ForkName.gloas);
  const beaconConfig = createBeaconConfig(chainConfig, Buffer.alloc(32));
  const pool = generateBuilderPendingDeposits(beaconConfig, 4, 5000);

  function buildState(payloadBlockHash: Uint8Array): CachedBeaconStateGloas {
    const stateView = ssz.gloas.BeaconState.defaultViewDU();
    // Provide a non-zero apply slot so cache key-stripping (slot=0) is exercised.
    stateView.slot = 32;
    stateView.latestExecutionPayloadBid.blockHash = payloadBlockHash;
    const state = createCachedBeaconStateTest(stateView, chainConfig, {
      skipSyncCommitteeCache: true,
      skipSyncPubkeys: true,
    });
    state.commit();
    return state;
  }

  it("onboards a builder without verifying signature when the deposit is in the cache", () => {
    const payloadBlockHash = Buffer.alloc(32, 0xab);
    const state = buildState(payloadBlockHash);
    const payloadBlockHashHex = `0x${payloadBlockHash.toString("hex")}`;

    // Deposit with a deliberately invalid signature. The fast path skips verification,
    // so the builder must still be onboarded — the proof that we took it.
    const depositInput = {...pool[0], signature: Buffer.alloc(96)};

    // Seed cache as if importExecutionPayload had pre-verified this deposit. The
    // payload-keyed cache uses PendingDepositNoSlot, so no slot is supplied here;
    // the consumer looks up with state.slot present and the hash matches because
    // the type excludes slot from identity.
    state.epochCtx.builderDepositSignatureCache.setPayloadResult(payloadBlockHashHex, depositInput, true);

    const buildersBefore = state.builders.length;
    processDepositRequest(ForkSeq.gloas, state, {...depositInput, index: 0n});
    expect(state.builders.length).toBe(buildersBefore + 1);
  });

  it("drops the deposit when cache says the signature is invalid (false result)", () => {
    const payloadBlockHash = Buffer.alloc(32, 0xbe);
    const state = buildState(payloadBlockHash);
    const payloadBlockHashHex = `0x${payloadBlockHash.toString("hex")}`;

    // Seed the cache with a `false` result — proves negative-cache fast path: the
    // deposit is dropped without re-running BLS verification AND without being added
    // to pendingDeposits. We use a *valid* signature so any code path that DID verify
    // would have onboarded the builder; the only way builders.length stays 0 is the
    // cache-says-invalid fast path returning early.
    const depositInput = pool[0];
    state.epochCtx.builderDepositSignatureCache.setPayloadResult(payloadBlockHashHex, depositInput, false);

    processDepositRequest(ForkSeq.gloas, state, {...depositInput, index: 0n});
    expect(state.builders.length).toBe(0);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("does NOT onboard when signature is invalid and cache miss (control)", () => {
    const payloadBlockHash = Buffer.alloc(32, 0xcd);
    const state = buildState(payloadBlockHash);

    // Invalid signature, no cache seed → goes through queueBuilderDeposit + batch verify,
    // which drops the deposit because signature is invalid.
    const depositInput = {...pool[0], signature: Buffer.alloc(96)};

    processDepositRequest(ForkSeq.gloas, state, {...depositInput, index: 0n});
    expect(state.builders.length).toBe(0);
    // Invalid + builder-prefix + not in cache → the deposit also doesn't end up
    // in pendingDeposits (the spec branch routes it to the builder queue, where
    // verification drops it).
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("does NOT take the fast path when the cache key does not match latestExecutionPayloadBid.blockHash", () => {
    const payloadBlockHash = Buffer.alloc(32, 0x11);
    const state = buildState(payloadBlockHash);
    const wrongKey = `0x${Buffer.alloc(32, 0x99).toString("hex")}`;

    // Invalid signature seeded under the wrong payload key → cache lookup at the
    // correct key (latestExecutionPayloadBid.blockHash) misses → builder not onboarded.
    const depositInput = {...pool[0], signature: Buffer.alloc(96)};
    state.epochCtx.builderDepositSignatureCache.setPayloadResult(wrongKey, depositInput, true);

    processDepositRequest(ForkSeq.gloas, state, {...depositInput, index: 0n});
    expect(state.builders.length).toBe(0);
  });
});
