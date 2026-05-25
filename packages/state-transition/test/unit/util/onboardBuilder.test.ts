import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {BUILDER_WITHDRAWAL_PREFIX, FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";
import {BatchOnboardBuilder} from "../../../src/util/onboardBuilder.js";

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
      batcher.addBuilderToRegistry(pool[0].pubkey, pool[0].withdrawalCredentials, pool[0].amount, pool[0].slot);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
    });
  });

  describe("addBuilderToRegistry — push path", () => {
    it("pushes a new builder when there are no pre-existing slots", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.addBuilderToRegistry(pool[0].pubkey, pool[0].withdrawalCredentials, pool[0].amount, pool[0].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);
      batcher.addBuilderToRegistry(pool[6].pubkey, pool[6].withdrawalCredentials, pool[6].amount, pool[6].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);
      // second call: cursor was set to preExisting.length; should push directly
      batcher.addBuilderToRegistry(pool[6].pubkey, pool[6].withdrawalCredentials, pool[6].amount, pool[6].slot);

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
      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

      expect(state.builders.length).toBe(2);
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[0].pubkey));
      expect(state.builders.get(0).balance).toBe(1_000_000_000);
      expect(toPubkeyHex(state.builders.get(1).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
    });

    it("skips the cache write when the index is past preExistingBuilders.length", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.addBuilderToRegistry(pool[0].pubkey, pool[0].withdrawalCredentials, pool[0].amount, pool[0].slot);
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

      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);
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

      batcher.onboardBuilders();

      expect(state.builders.length).toBe(0);
    });

    it("onboardBuilders applies all queued valid deposits and clears the queue", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[1].pubkey), pool[1]);
      batcher.onboardBuilders();

      expect(state.builders.length).toBe(2);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[0].pubkey))).toBe(0);
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[1].pubkey))).toBe(1);

      // queue cleared — calling again is a no-op
      batcher.onboardBuilders();
      expect(state.builders.length).toBe(2);
    });

    it("onboardBuilders drops deposits with invalid signatures (batch fallback)", () => {
      const state = buildGloasState();
      const batcher = new BatchOnboardBuilder(state);

      const bad = withInvalidSignature(pool[1]);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[0].pubkey), pool[0]);
      batcher.queueBuilderDeposit(toPubkeyHex(bad.pubkey), bad);
      batcher.queueBuilderDeposit(toPubkeyHex(pool[2].pubkey), pool[2]);
      batcher.onboardBuilders();

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
      batcher.onboardBuilders();

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

      batcher.onboardBuilders();
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
      batcher.onboardBuilders();

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
      batcher.onboardBuilders();
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
      batcher.addBuilderToRegistry(pool[5].pubkey, pool[5].withdrawalCredentials, pool[5].amount, pool[5].slot);

      // The displaced pubkey must not resolve to slot 0 anymore — otherwise a
      // top-up for pool[50] would silently credit pool[5]'s balance.
      expect(batcher.getAppliedBuilderIndex(toPubkeyHex(pool[50].pubkey))).toBe(null);

      // Sanity: slot 0 actually holds pool[5] now
      expect(toPubkeyHex(state.builders.get(0).pubkey)).toBe(toPubkeyHex(pool[5].pubkey));
    });
  });
});
