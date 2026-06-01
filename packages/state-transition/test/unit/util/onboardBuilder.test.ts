import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {BUILDER_WITHDRAWAL_PREFIX, FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../../../src/types.js";
import {
  BatchOnboardBuilder,
  MAX_BUILDER_DEPOSITS_PER_SLOT,
  preVerifyBuilderDepositsPreGloas,
  preVerifyPayloadBuilderDeposits,
} from "../../../src/util/onboardBuilder.js";

describe("BatchOnboardBuilder", () => {
  const chainConfig = getConfig(ForkName.gloas);
  const beaconConfig = createBeaconConfig(chainConfig, Buffer.alloc(32));
  // Pool of validly-signed builder deposits — distinct interop pubkeys [1000, 1099)
  const pool = generateBuilderPendingDeposits(beaconConfig, 100, 1000);

  function withInvalidSignature(deposit: electra.PendingDeposit): electra.PendingDeposit {
    return {...deposit, signature: Buffer.alloc(96)};
  }

  /**
   * Build a Gloas state with optional pre-existing builders and a configurable slot.
   * `slot` controls `currentEpoch` for reuse eligibility checks.
   */
  function buildGloasState(
    opts: {
      preExistingBuilders?: Array<{
        pubkey: Uint8Array;
        balance: number;
        withdrawableEpoch: number;
      }>;
      slot?: number;
    } = {}
  ): CachedBeaconStateGloas {
    const stateView = ssz.gloas.BeaconState.defaultViewDU();
    if (opts.slot !== undefined) {
      stateView.slot = opts.slot;
    }
    for (const b of opts.preExistingBuilders ?? []) {
      stateView.builders.push(
        ssz.gloas.Builder.toViewDU({
          pubkey: b.pubkey,
          version: BUILDER_WITHDRAWAL_PREFIX,
          executionAddress: Buffer.alloc(20),
          balance: b.balance,
          depositEpoch: 0,
          withdrawableEpoch: b.withdrawableEpoch,
        })
      );
    }
    const state = createCachedBeaconStateTest(stateView, chainConfig, {
      skipSyncCommitteeCache: true,
      skipSyncPubkeys: true,
    });
    state.commit();
    return state;
  }

  /** A pre-existing builder eligible for reuse (`balance === 0`, `withdrawableEpoch <= currentEpoch`). */
  function exitedBuilder(pubkey: Uint8Array, withdrawableEpoch = 0) {
    return {pubkey, balance: 0, withdrawableEpoch};
  }

  /** A pre-existing builder NOT eligible for reuse (non-zero balance). */
  function activeBuilder(pubkey: Uint8Array, balance = 1_000_000_000) {
    return {pubkey, balance, withdrawableEpoch: FAR_FUTURE_EPOCH};
  }

  describe("constructor", () => {
    it("starts with empty map and cache when state has no builders", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);
    });

    it("populates map and cache from pre-existing builders", () => {
      const state = buildGloasState({
        preExistingBuilders: [activeBuilder(pool[0].pubkey), activeBuilder(pool[1].pubkey)],
      });
      const batcher = new BatchOnboardBuilder(state);

      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[2].pubkey))).toBe(null);
    });
  });

  describe("getAppliedBuilderIndex", () => {
    it("returns null for an unknown pubkey", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);
    });

    it("returns the index after addBuilderToRegistry pushes", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);
      batcher.onboardBuilderVerifiedSignature(pool[0]);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
    });
  });

  describe("addBuilderToRegistry — push path", () => {
    it("pushes a new builder when there are no pre-existing slots", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[0]);

      expect(state.builders.length).toBe(1);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(state.builders.get(0).balance).toBe(pool[0].amount);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
    });

    it("pushes when no pre-existing slot is eligible", () => {
      const state = buildGloasState({
        preExistingBuilders: [activeBuilder(pool[0].pubkey), activeBuilder(pool[1].pubkey)],
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);

      expect(state.builders.length).toBe(3);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[5].pubkey))).toBe(2);
      // pre-existing builders untouched
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);
    });
  });

  describe("addBuilderToRegistry — reuse path", () => {
    it("reuses an eligible slot and replaces its contents", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[0].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);

      // length unchanged — slot was reused
      expect(state.builders.length).toBe(1);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
      expect(state.builders.get(0).balance).toBe(pool[5].amount);
    });

    it("removes the displaced pubkey from the map and records the new one", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[0].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);

      // displaced pubkey is gone; new pubkey points at the reused slot
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[5].pubkey))).toBe(0);
    });

    it("skips ineligible slots and reuses the first eligible one", () => {
      const state = buildGloasState({
        preExistingBuilders: [
          activeBuilder(pool[0].pubkey), // index 0: non-zero balance, skip
          exitedBuilder(pool[1].pubkey), // index 1: eligible, reuse
          exitedBuilder(pool[2].pubkey), // index 2: also eligible but reached after 1
        ],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);

      expect(state.builders.length).toBe(3);
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(null);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[5].pubkey))).toBe(1);
    });

    it("reuses subsequent eligible slots on later calls (cursor advances)", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[0].pubkey), exitedBuilder(pool[1].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);
      batcher.onboardBuilderVerifiedSignature(pool[6]);

      expect(state.builders.length).toBe(2);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[6].pubkey));
    });

    it("does not reuse a builder whose withdrawableEpoch > currentEpoch", () => {
      const currentEpoch = 5;
      const state = buildGloasState({
        preExistingBuilders: [
          // balance===0 but withdrawableEpoch=10 > currentEpoch=5 → not eligible
          {pubkey: pool[0].pubkey, balance: 0, withdrawableEpoch: 10},
        ],
        slot: currentEpoch * SLOTS_PER_EPOCH,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);

      // pushed at end, not reused
      expect(state.builders.length).toBe(2);
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
    });

    it("does not re-scan slots after a full scan with no eligible candidates", () => {
      const state = buildGloasState({
        preExistingBuilders: [activeBuilder(pool[0].pubkey), activeBuilder(pool[1].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);
      // second call: cursor was set to preExisting.length; should push directly
      batcher.onboardBuilderVerifiedSignature(pool[6]);

      expect(state.builders.length).toBe(4);
      expect(toPubkeyHex(state.builders.get(2).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
      expect(toPubkeyHex(state.builders.get(3).pubkey)).toBe(toPubkeyHex(pool[6].pubkey));
    });
  });

  describe("topupBuilder", () => {
    it("increments the balance of a pre-existing builder in state and cache", () => {
      const state = buildGloasState({
        preExistingBuilders: [activeBuilder(pool[0].pubkey, 1_000_000_000)],
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.topupBuilder(0, 500_000_000);

      expect(state.builders.get(0).balance).toBe(1_500_000_000);
    });

    it("cache stays in sync so subsequent reuse-scans see the bumped balance", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[0].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      // top up the previously-eligible (balance=0) slot, making it ineligible
      batcher.topupBuilder(0, 1_000_000_000);

      // now try to onboard a new builder — should push, not reuse slot 0
      batcher.onboardBuilderVerifiedSignature(pool[5]);

      expect(state.builders.length).toBe(2);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(state.builders.get(0).balance).toBe(1_000_000_000);
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
    });

    it("skips the cache write when the index is past preExistingBuilders.length", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[0]);
      // Index 0 is past the empty preExistingBuilders array. Should not throw.
      batcher.topupBuilder(0, 500_000_000);

      expect(state.builders.get(0).balance).toBe(pool[0].amount + 500_000_000);
    });

    it("topup of a freshly-reused slot updates both state and cache", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[0].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardBuilderVerifiedSignature(pool[5]);
      // slot 0 now holds pool[5]; index 0 is still < preExistingBuilders.length
      batcher.topupBuilder(0, 500_000_000);

      expect(state.builders.get(0).balance).toBe(pool[5].amount + 500_000_000);
    });
  });

  describe("queueBuilderDeposit + onboardBuilders", () => {
    it("queues a deposit without flushing when under batch size", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);

      // not yet flushed
      expect(state.builders.length).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);
    });

    it("auto-flushes when the queue reaches BUILDER_DEPOSIT_BATCH_SIZE (32)", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      for (let i = 0; i < 32; i++) {
        batcher.queueBuilderDeposit(toPubkeyHex(pool[i].pubkey), pool[i]);
      }

      expect(state.builders.length).toBe(32);
      for (let i = 0; i < 32; i++) {
        expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[i].pubkey))).toBe(i);
      }
    });

    it("onboardBuilders is a no-op when the queue is empty", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.onboardQueuedBuilders();

      expect(state.builders.length).toBe(0);
    });

    it("onboardBuilders applies all queued valid deposits and clears the queue", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      batcher.onboardQueuedBuilders();

      expect(state.builders.length).toBe(2);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);

      // queue cleared — calling again is a no-op
      batcher.onboardQueuedBuilders();
      expect(state.builders.length).toBe(2);
    });

    it("onboardBuilders drops deposits with invalid signatures (batch fallback)", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      const bad = withInvalidSignature(pool[1]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      batcher.queueBuilderDeposit(toPubkeyHex(bad.pubkey), bad);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[2].pubkey), pool[2]);
      batcher.onboardQueuedBuilders();

      // valid deposits onboarded, invalid one dropped
      expect(state.builders.length).toBe(2);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(bad.pubkey))).toBe(null);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[2].pubkey))).toBe(1);
    });

    it("onboardBuilders reuses pre-existing eligible slots for the queued batch", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey), activeBuilder(pool[51].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      batcher.onboardQueuedBuilders();

      // pool[0] reuses slot 0 (eligible); pool[1] pushes to slot 2 (since cursor moved past 1 which is ineligible)
      expect(state.builders.length).toBe(3);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[51].pubkey));
      expect(toPubkeyHex(state.builders.get(2).pubkey)).toBe(toPubkeyHex(pool[1].pubkey));

      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[50].pubkey))).toBe(null); // displaced
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(2);
    });
  });

  describe("onboardBuildersIfQueued", () => {
    let state: CachedBeaconStateGloas;
    let batcher: BatchOnboardBuilder;

    beforeEach(() => {
      state = buildGloasState();
      batcher = new BatchOnboardBuilder(state);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
    });

    it("is a no-op when the pubkey is not in the queue", () => {
      batcher.onboardBuildersIfQueued(toPubkeyHex(pool[99].pubkey));
      expect(state.builders.length).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);
    });

    it("flushes the entire queue when the pubkey is queued", () => {
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      // Both pool[0] and pool[1] are queued. Trigger via pool[0]'s pubkey.
      batcher.onboardBuildersIfQueued(toPubkeyHex(pool[0].pubkey));

      // entire queue was flushed
      expect(state.builders.length).toBe(2);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);
    });
  });

  describe("queueBuilderDeposit — flush-when-reuse-possible (spec ordering)", () => {
    // queueBuilderDeposit must flush immediately when a pre-existing slot may still
    // be reused, otherwise a later topup of a pre-existing builder would silently
    // win the race for that slot (chain-split vs. eager). Once the cursor exhausts
    // preExistingBuilders, deferring is safe.

    it("flushes immediately when a pre-existing eligible slot exists", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);

      // Onboarded immediately into the reused slot — NOT still queued
      expect(state.builders.length).toBe(1);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      // The displaced pre-existing pubkey is no longer in the map
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[50].pubkey))).toBe(null);
    });

    it("defers when no pre-existing slot is eligible (reuse exhausted)", () => {
      const state = buildGloasState({
        preExistingBuilders: [activeBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);

      // Still queued — pre-existing is full and ineligible, so deferral is safe
      expect(state.builders.length).toBe(1); // just the pre-existing builder
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(null);

      batcher.onboardQueuedBuilders();
      expect(state.builders.length).toBe(2);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(1);
    });

    it("[newD, topupA] preserves spec order: D reuses A's slot, A re-routes as new onboard", () => {
      // Pre-existing A eligible at slot 0. Envelope mirrors the spec-ordering bug:
      // batched-naive would defer D and let topupA hit slot 0 first — eager (spec)
      // gives D slot 0 and routes A's deposit as a new onboard.
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      // Simulate the processDepositRequest routing:
      // Step 1 — newD: queueBuilderDeposit flushes immediately, reuses slot 0.
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);

      // Step 2 — topupA: getAppliedBuilderIndex(A) is now null (displaced),
      // so the caller routes A's deposit as a new-builder candidate.
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[50].pubkey))).toBe(null);

      // pool[50]'s pubkey doesn't have a real signed deposit in the pool; reuse pool[1]
      // as the new-onboard deposit to keep BLS happy. The point is the ordering, not the pubkey.
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      batcher.onboardQueuedBuilders();

      // Final state: D at slot 0 (reused), the re-routed deposit at slot 1 (pushed)
      expect(state.builders.length).toBe(2);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[1].pubkey));
    });

    it("[topupA, newD] preserves spec order: A topped up, D pushed at end", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      // topupA — caller sees getAppliedBuilderIndex(A)=0 and calls topupBuilder
      batcher.topupBuilder(0, 500_000_000);

      // newD — cursor is still 0 (topup doesn't advance it), so queueBuilderDeposit
      // flushes; the scan finds slot 0 ineligible (balance>0 after topup) and pushes
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);

      expect(state.builders.length).toBe(2);
      // slot 0 = the topped-up pre-existing builder
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[50].pubkey));
      expect(state.builders.get(0).balance).toBe(500_000_000);
      // slot 1 = D, pushed
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
    });

    it("transitions from flush-eagerly to batch once cursor exhausts preExistingBuilders", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      // First queue: cursor=0 < 1 → immediate flush, reuses slot 0, cursor=1
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      expect(state.builders.length).toBe(1);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));

      // Subsequent queues: cursor=1 >= 1 → deferred
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[2].pubkey), pool[2]);
      expect(state.builders.length).toBe(1); // still just the reused slot
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(null);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[2].pubkey))).toBe(null);

      // End-of-envelope flush applies the deferred batch
      batcher.onboardQueuedBuilders();
      expect(state.builders.length).toBe(3);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[2].pubkey))).toBe(2);
    });
  });

  describe("stale-entry regression (the reason this class is unit-tested)", () => {
    // The original bug: reusing a slot left the displaced pubkey in the map, causing
    // a later deposit for the displaced pubkey to be wrongly routed as a top-up.
    it("a deposit for a displaced pubkey is NOT routed via the map after reuse", () => {
      const state = buildGloasState({
        preExistingBuilders: [exitedBuilder(pool[50].pubkey)],
        slot: 0,
      });
      const batcher = new BatchOnboardBuilder(state);

      // Reuse slot 0 for pool[5]
      batcher.onboardBuilderVerifiedSignature(pool[5]);

      // The displaced pubkey must not resolve to slot 0 anymore — otherwise a
      // top-up for pool[50] would silently credit pool[5]'s balance.
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[50].pubkey))).toBe(null);

      // Sanity: slot 0 actually holds pool[5] now
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
    });
  });

  describe("preVerifyBuilderDepositsPreGloas", () => {
    /** Pool of validly-signed builder deposits — distinct interop pubkeys [3000, 3099). */
    const scannerPool = generateBuilderPendingDeposits(beaconConfig, 100, 3000);

    function depositAtSlot(deposit: electra.PendingDeposit, slot: number): electra.PendingDeposit {
      return {...deposit, slot};
    }

    /**
     * Build a pre-Gloas cached state with pre-populated pendingDeposits. A Gloas state
     * cast as CachedBeaconStateElectra works — preVerifyBuilderDepositsPreGloas only touches
     * pendingDeposits + epochCtx.builderDepositSignatureCache, which are present on all
     * post-Electra forks.
     */
    function buildStateWithDeposits(deposits: electra.PendingDeposit[]): CachedBeaconStateElectra {
      const stateView = ssz.gloas.BeaconState.defaultViewDU();
      for (const d of deposits) {
        stateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(d));
      }
      const cachedState = createCachedBeaconStateTest(stateView, chainConfig, {
        skipSyncCommitteeCache: true,
        skipSyncPubkeys: true,
      });
      cachedState.commit();
      return cachedState as unknown as CachedBeaconStateElectra;
    }

    it("returns zero counts and null slot range when there are no pending deposits", () => {
      const state = buildStateWithDeposits([]);
      const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);
      expect(result).toEqual({verifiedCount: 0, invalidCount: 0, fromSlot: null, toSlot: null});
      // -1 is the "no slot verified" sentinel
      expect(state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot).toBe(-1);
    });

    it("verifies builder-prefix deposits and stashes them on the cache", () => {
      const deposits = [
        depositAtSlot(scannerPool[0], 1),
        depositAtSlot(scannerPool[1], 1),
        depositAtSlot(scannerPool[2], 2),
      ];
      const state = buildStateWithDeposits(deposits);

      const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);

      expect(result.verifiedCount).toBe(3);
      expect(result.invalidCount).toBe(0);
      expect(result.fromSlot).toBe(1);
      expect(result.toSlot).toBe(2);
      expect(state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot).toBe(2);
      for (const d of deposits) {
        expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(d)).toBe(true);
      }
    });

    it("skips deposits whose withdrawal credential prefix is not BUILDER_WITHDRAWAL_PREFIX", () => {
      const validatorDeposit: electra.PendingDeposit = {
        ...scannerPool[0],
        // 0x01 = eth1 withdrawal credential (validator, not builder)
        withdrawalCredentials: Buffer.concat([Buffer.from([0x01]), Buffer.alloc(31, 0)]),
        slot: 1,
      };
      const builderDeposit = depositAtSlot(scannerPool[1], 2);
      const state = buildStateWithDeposits([validatorDeposit, builderDeposit]);

      const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);

      // Only the builder deposit was processed
      expect(result.verifiedCount).toBe(1);
      expect(result.fromSlot).toBe(2);
      expect(result.toSlot).toBe(2);
      // validator-prefix deposit is filtered out before reaching the verifier → not in cache.
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(validatorDeposit)).toBe(null);
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(builderDeposit)).toBe(true);
    });

    it("skips deposits with slot <= lastVerifiedSlot (cursor honored)", () => {
      const deposits = [
        depositAtSlot(scannerPool[0], 1),
        depositAtSlot(scannerPool[1], 2),
        depositAtSlot(scannerPool[2], 3),
      ];
      const state = buildStateWithDeposits(deposits);

      // Pretend slots 1 and 2 were already verified in a prior tick
      state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot = 2;

      const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);

      expect(result.verifiedCount).toBe(1);
      expect(result.fromSlot).toBe(3);
      expect(result.toSlot).toBe(3);
      // deposits[0] was below the cursor → never reached the verifier → not in cache.
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(deposits[0])).toBe(null);
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(deposits[2])).toBe(true);
    });

    it("counts invalid signatures separately and records them as false in the cache", () => {
      const good1 = depositAtSlot(scannerPool[0], 1);
      const bad: electra.PendingDeposit = {...depositAtSlot(scannerPool[1], 1), signature: Buffer.alloc(96)};
      const good2 = depositAtSlot(scannerPool[2], 1);
      const state = buildStateWithDeposits([good1, bad, good2]);

      const result = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);

      expect(result.verifiedCount).toBe(2);
      expect(result.invalidCount).toBe(1);
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(good1)).toBe(true);
      // Bad signatures are now recorded as `false` (not missing) so the fork-transition
      // consumer can skip them without re-verifying.
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(bad)).toBe(false);
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(good2)).toBe(true);
    });

    it("stops on a slot boundary when maxBuilderDeposits is exceeded", () => {
      // Two deposits at slot 1, two at slot 2, two at slot 3
      const deposits = [
        depositAtSlot(scannerPool[0], 1),
        depositAtSlot(scannerPool[1], 1),
        depositAtSlot(scannerPool[2], 2),
        depositAtSlot(scannerPool[3], 2),
        depositAtSlot(scannerPool[4], 3),
        depositAtSlot(scannerPool[5], 3),
      ];
      const state = buildStateWithDeposits(deposits);

      // Cap at 3 — the third deposit (slot 2) pushes us past the cap, but we keep going
      // until slot transitions to a strictly greater one. So we should pick up both slot-2
      // deposits (4 total) and stop before slot 3.
      const result = preVerifyBuilderDepositsPreGloas(state, 3);

      expect(result.verifiedCount).toBe(4);
      expect(result.invalidCount).toBe(0);
      expect(result.fromSlot).toBe(1);
      expect(result.toSlot).toBe(2);
      // lastVerifiedSlot advances only over fully-completed slots
      expect(state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot).toBe(2);
      // deposits[4] and deposits[5] sit beyond the slot-boundary cutoff → never reach the
      // verifier → no cache entry (null), not a recorded `false`.
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(deposits[4])).toBe(null);
      expect(state.epochCtx.builderDepositSignatureCache.getPreGloasResult(deposits[5])).toBe(null);
    });

    it("subsequent call resumes at lastVerifiedSlot + 1", () => {
      const deposits = [
        depositAtSlot(scannerPool[0], 1),
        depositAtSlot(scannerPool[1], 2),
        depositAtSlot(scannerPool[2], 2),
        depositAtSlot(scannerPool[3], 3),
      ];
      const state = buildStateWithDeposits(deposits);

      // First call: cap at 1, so we pick up slot 1 only (1 deposit, finishes that slot)
      const r1 = preVerifyBuilderDepositsPreGloas(state, 1);
      expect(r1.verifiedCount).toBe(1);
      expect(r1.fromSlot).toBe(1);
      expect(r1.toSlot).toBe(1);
      expect(state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot).toBe(1);

      // Second call: resumes at slot 2 onward
      const r2 = preVerifyBuilderDepositsPreGloas(state, MAX_BUILDER_DEPOSITS_PER_SLOT);
      expect(r2.verifiedCount).toBe(3);
      expect(r2.fromSlot).toBe(2);
      expect(r2.toSlot).toBe(3);
      expect(state.epochCtx.builderDepositSignatureCache.lastVerifiedSlot).toBe(3);
    });
  });

  describe("preVerifyEnvelopeBuilderDeposits", () => {
    /** Pool of validly-signed builder deposits — distinct interop pubkeys [4000, 4099). */
    const envelopePool = generateBuilderPendingDeposits(beaconConfig, 100, 4000);
    const payloadBlockHash = "0xabc".padEnd(66, "c");

    function freshState(): CachedBeaconStateGloas {
      return buildGloasState();
    }

    it("returns zero counts and writes nothing when given an empty list", () => {
      const state = freshState();
      const result = preVerifyPayloadBuilderDeposits(state, payloadBlockHash, []);
      expect(result).toEqual({verifiedCount: 0, invalidCount: 0});
      // Nothing recorded — empty input never reached the verifier.
      expect(state.epochCtx.builderDepositSignatureCache.getPayloadResult(payloadBlockHash, envelopePool[0])).toBe(
        null
      );
    });

    it("verifies and caches each builder-prefix deposit under the given payloadBlockHash", () => {
      const state = freshState();
      const deposits = envelopePool.slice(0, 3).map((d) => ({...d, slot: 0}));

      const result = preVerifyPayloadBuilderDeposits(state, payloadBlockHash, deposits);

      expect(result.verifiedCount).toBe(3);
      expect(result.invalidCount).toBe(0);
      for (const d of deposits) {
        expect(state.epochCtx.builderDepositSignatureCache.getPayloadResult(payloadBlockHash, d)).toBe(true);
      }
    });

    it("counts invalid signatures separately and records them as false in the cache", () => {
      const state = freshState();
      const good1 = {...envelopePool[0], slot: 0};
      const bad = withInvalidSignature({...envelopePool[1], slot: 0});
      const good2 = {...envelopePool[2], slot: 0};

      const result = preVerifyPayloadBuilderDeposits(state, payloadBlockHash, [good1, bad, good2]);

      expect(result.verifiedCount).toBe(2);
      expect(result.invalidCount).toBe(1);
      const cache = state.epochCtx.builderDepositSignatureCache;
      expect(cache.getPayloadResult(payloadBlockHash, good1)).toBe(true);
      // Bad signatures are now recorded as `false` (not missing) so the next-block
      // consumer can skip them without re-verifying.
      expect(cache.getPayloadResult(payloadBlockHash, bad)).toBe(false);
      expect(cache.getPayloadResult(payloadBlockHash, good2)).toBe(true);
    });

    it("cached entries are queryable with the consumer's apply-slot (slot is stripped)", () => {
      // Producer writes with slot:0 (envelope-import doesn't know apply slot). Consumer
      // (processDepositRequest) queries with state.slot of the child block.
      const state = freshState();
      const producerView = {...envelopePool[0], slot: 0};
      const consumerView = {...envelopePool[0], slot: 42};

      preVerifyPayloadBuilderDeposits(state, payloadBlockHash, [producerView]);

      expect(state.epochCtx.builderDepositSignatureCache.getPayloadResult(payloadBlockHash, consumerView)).toBe(true);
    });
  });
});
