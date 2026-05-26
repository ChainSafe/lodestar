import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {electra} from "@lodestar/types";
import {GloaOnboardBuilderCache} from "../../../src/cache/onboardBuildersCache.js";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";

describe("GloaOnboardBuilderCache", () => {
  const beaconConfig = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32));
  // Pool of validly-signed builder deposits — distinct interop pubkeys [2000, 2009)
  const pool = generateBuilderPendingDeposits(beaconConfig, 10, 2000);

  /** Make a copy of a pool deposit at a specific slot. */
  function atSlot(deposit: electra.PendingDeposit, slot: number): electra.PendingDeposit {
    return {...deposit, slot};
  }

  describe("lastVerifiedSlot", () => {
    it("defaults to 0", () => {
      const cache = new GloaOnboardBuilderCache();
      expect(cache.lastVerifiedSlot).toBe(0);
    });

    it("setter is monotonic — accepts strictly greater values, ignores smaller", () => {
      const cache = new GloaOnboardBuilderCache();

      cache.lastVerifiedSlot = 10;
      expect(cache.lastVerifiedSlot).toBe(10);

      cache.lastVerifiedSlot = 20;
      expect(cache.lastVerifiedSlot).toBe(20);

      // Lower values ignored
      cache.lastVerifiedSlot = 5;
      expect(cache.lastVerifiedSlot).toBe(20);

      // Equal value ignored (strict-greater contract)
      cache.lastVerifiedSlot = 20;
      expect(cache.lastVerifiedSlot).toBe(20);
    });
  });

  describe("setVerifiedDeposit + isBuilderDepositVerified", () => {
    it("returns false for an unseen deposit", () => {
      const cache = new GloaOnboardBuilderCache();
      expect(cache.isBuilderDepositVerified(atSlot(pool[0], 5))).toBe(false);
    });

    it("returns true after setVerifiedDeposit on the same (slot, content)", () => {
      const cache = new GloaOnboardBuilderCache();
      const d = atSlot(pool[0], 5);
      cache.setVerifiedDeposit(d);
      expect(cache.isBuilderDepositVerified(d)).toBe(true);
    });

    it("returns false when a different deposit at the same slot is queried", () => {
      const cache = new GloaOnboardBuilderCache();
      cache.setVerifiedDeposit(atSlot(pool[0], 5));
      // Same slot, different pubkey → root differs → not in cache
      expect(cache.isBuilderDepositVerified(atSlot(pool[1], 5))).toBe(false);
    });

    it("returns false when the same content is queried at a different slot", () => {
      const cache = new GloaOnboardBuilderCache();
      cache.setVerifiedDeposit(atSlot(pool[0], 5));
      // Slot is part of the hash-tree-root, so a different slot looks up to a different bucket
      expect(cache.isBuilderDepositVerified(atSlot(pool[0], 6))).toBe(false);
    });

    it("distinguishes two deposits with same pubkey/slot but different signatures", () => {
      const cache = new GloaOnboardBuilderCache();
      const d1 = atSlot(pool[0], 5);
      const d2: electra.PendingDeposit = {...d1, signature: Buffer.alloc(96, 0xff)};
      cache.setVerifiedDeposit(d1);
      expect(cache.isBuilderDepositVerified(d1)).toBe(true);
      expect(cache.isBuilderDepositVerified(d2)).toBe(false);
    });

    it("holds entries across multiple slots independently", () => {
      const cache = new GloaOnboardBuilderCache();
      const d5 = atSlot(pool[0], 5);
      const d6 = atSlot(pool[1], 6);
      cache.setVerifiedDeposit(d5);
      cache.setVerifiedDeposit(d6);
      expect(cache.isBuilderDepositVerified(d5)).toBe(true);
      expect(cache.isBuilderDepositVerified(d6)).toBe(true);
    });
  });

  describe("clear", () => {
    it("empties the verified-roots map and resets lastVerifiedSlot to 0", () => {
      const cache = new GloaOnboardBuilderCache();
      const d = atSlot(pool[0], 5);
      cache.setVerifiedDeposit(d);
      cache.lastVerifiedSlot = 42;

      cache.clear();

      expect(cache.lastVerifiedSlot).toBe(0);
      expect(cache.isBuilderDepositVerified(d)).toBe(false);
    });

    it("monotonic setter still works after clear (counter truly reset)", () => {
      const cache = new GloaOnboardBuilderCache();
      cache.lastVerifiedSlot = 100;
      cache.clear();
      // After clear, a smaller value than the pre-clear max should now be accepted
      cache.lastVerifiedSlot = 10;
      expect(cache.lastVerifiedSlot).toBe(10);
    });
  });
});
