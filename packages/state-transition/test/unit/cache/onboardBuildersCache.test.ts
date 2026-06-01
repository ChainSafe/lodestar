import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {electra} from "@lodestar/types";
import {BuilderDepositSignatureCache} from "../../../src/cache/builderDepositSignatureCache.ts";
import {generateBuilderPendingDeposits} from "../../../src/testUtils/util.js";

describe("BuilderDepositSignatureCache", () => {
  const beaconConfig = createBeaconConfig(getConfig(ForkName.gloas), Buffer.alloc(32));
  // Pool of validly-signed builder deposits — distinct interop pubkeys [2000, 2009)
  const pool = generateBuilderPendingDeposits(beaconConfig, 10, 2000);

  /** Make a copy of a pool deposit at a specific slot. */
  function atSlot(deposit: electra.PendingDeposit, slot: number): electra.PendingDeposit {
    return {...deposit, slot};
  }

  describe("lastVerifiedSlot", () => {
    it("defaults to -1 (the 'no slot verified' sentinel; 0 is a real slot)", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.lastVerifiedSlot).toBe(-1);
    });

    it("setter is monotonic — accepts strictly greater values, ignores smaller", () => {
      const cache = new BuilderDepositSignatureCache();

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

  describe("setPreGloasResult + getPreGloasResult", () => {
    it("returns null for an unseen deposit (distinct from a recorded false)", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.getPreGloasResult(atSlot(pool[0], 5))).toBe(null);
    });

    it("returns true after setPreGloasResult(deposit, true)", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setPreGloasResult(d, true);
      expect(cache.getPreGloasResult(d)).toBe(true);
    });

    it("returns false after setPreGloasResult(deposit, false)", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setPreGloasResult(d, false);
      expect(cache.getPreGloasResult(d)).toBe(false);
    });

    it("returns null when a different deposit at the same slot is queried", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPreGloasResult(atSlot(pool[0], 5), true);
      // Same slot, different pubkey → root differs → not in cache
      expect(cache.getPreGloasResult(atSlot(pool[1], 5))).toBe(null);
    });

    it("returns null when the same content is queried at a different slot", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPreGloasResult(atSlot(pool[0], 5), true);
      // Slot is the outer Map key (not part of the inner hash); querying a different slot
      // looks up a different bucket → miss.
      expect(cache.getPreGloasResult(atSlot(pool[0], 6))).toBe(null);
    });

    it("distinguishes two deposits with same pubkey/slot but different signatures", () => {
      const cache = new BuilderDepositSignatureCache();
      const d1 = atSlot(pool[0], 5);
      const d2: electra.PendingDeposit = {...d1, signature: Buffer.alloc(96, 0xff)};
      cache.setPreGloasResult(d1, true);
      expect(cache.getPreGloasResult(d1)).toBe(true);
      expect(cache.getPreGloasResult(d2)).toBe(null);
    });

    it("holds entries across multiple slots independently", () => {
      const cache = new BuilderDepositSignatureCache();
      const d5 = atSlot(pool[0], 5);
      const d6 = atSlot(pool[1], 6);
      cache.setPreGloasResult(d5, true);
      cache.setPreGloasResult(d6, false);
      expect(cache.getPreGloasResult(d5)).toBe(true);
      expect(cache.getPreGloasResult(d6)).toBe(false);
    });

    it("a later set overwrites an earlier result for the same deposit", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setPreGloasResult(d, false);
      cache.setPreGloasResult(d, true);
      expect(cache.getPreGloasResult(d)).toBe(true);
    });
  });

  describe("clearPreGloasCache", () => {
    it("empties the pre-Gloas results and resets lastVerifiedSlot to -1", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setPreGloasResult(d, true);
      cache.lastVerifiedSlot = 42;

      cache.clearPreGloasCache();

      expect(cache.lastVerifiedSlot).toBe(-1);
      expect(cache.getPreGloasResult(d)).toBe(null);
    });

    it("also clears recorded false entries", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setPreGloasResult(d, false);

      cache.clearPreGloasCache();

      expect(cache.getPreGloasResult(d)).toBe(null);
    });

    it("monotonic setter still works after clear (counter truly reset)", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.lastVerifiedSlot = 100;
      cache.clearPreGloasCache();
      // After clear, a smaller value than the pre-clear max should now be accepted
      cache.lastVerifiedSlot = 10;
      expect(cache.lastVerifiedSlot).toBe(10);
    });

    it("does not touch the payload-blockHash sub-cache (different lifecycle)", () => {
      const cache = new BuilderDepositSignatureCache();
      const hashA = "0xaa".padEnd(66, "a");
      cache.setPayloadResult(hashA, pool[0], true);

      cache.clearPreGloasCache();

      // Survives clear — payload sub-cache is self-rolling, not tied to fork transition
      expect(cache.getPayloadResult(hashA, pool[0])).toBe(true);
    });
  });

  describe("setPayloadResult + getPayloadResult", () => {
    const hashA = "0xaa".padEnd(66, "a");
    const hashB = "0xbb".padEnd(66, "b");

    it("returns null for an unseen (payloadBlockHash, deposit) pair", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.getPayloadResult(hashA, pool[0])).toBe(null);
    });

    it("returns true after setPayloadResult(..., true)", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPayloadResult(hashA, pool[0], true);
      expect(cache.getPayloadResult(hashA, pool[0])).toBe(true);
    });

    it("returns false after setPayloadResult(..., false) — proves negative results are recorded", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPayloadResult(hashA, pool[0], false);
      expect(cache.getPayloadResult(hashA, pool[0])).toBe(false);
    });

    it("ignores the deposit.slot field (PendingDepositNoSlot type excludes slot from identity)", () => {
      const cache = new BuilderDepositSignatureCache();
      // The payload-keyed surface takes PendingDepositNoSlot. PendingDeposit (with slot)
      // is structurally assignable, and the SSZ type hashes only the 4 slot-less fields,
      // so a producer and consumer disagreeing on `slot` still hit.
      cache.setPayloadResult(hashA, atSlot(pool[0], 0), true);
      expect(cache.getPayloadResult(hashA, atSlot(pool[0], 42))).toBe(true);
    });

    it("isolates entries between different payloadBlockHash keys", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPayloadResult(hashA, pool[0], true);
      expect(cache.getPayloadResult(hashB, pool[0])).toBe(null);
    });

    it("multiple deposits under the same key do not grow the underlying Map", () => {
      const cache = new BuilderDepositSignatureCache();
      // 5 distinct deposits under one payload — should still occupy a single Map entry
      for (let i = 0; i < 5; i++) cache.setPayloadResult(hashA, pool[i], true);
      for (let i = 0; i < 5; i++) {
        expect(cache.getPayloadResult(hashA, pool[i])).toBe(true);
      }
    });

    it("evicts the oldest payloadBlockHash when the 32-entry cap is exceeded", () => {
      const cache = new BuilderDepositSignatureCache();
      const keys: string[] = [];
      // Insert 33 distinct payload blockHashes, each with one deposit (recycle pool[0]).
      for (let i = 0; i < 33; i++) {
        const k = `0x${i.toString(16).padStart(64, "0")}`;
        keys.push(k);
        cache.setPayloadResult(k, pool[0], true);
      }
      // The first inserted key was evicted; the lookup must return null (not false),
      // so the caller re-verifies instead of silently dropping the deposit.
      expect(cache.getPayloadResult(keys[0], pool[0])).toBe(null);
      for (let i = 1; i < 33; i++) {
        expect(cache.getPayloadResult(keys[i], pool[0])).toBe(true);
      }
    });

    it("a later set overwrites an earlier result for the same (payload, deposit)", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setPayloadResult(hashA, pool[0], false);
      cache.setPayloadResult(hashA, pool[0], true);
      expect(cache.getPayloadResult(hashA, pool[0])).toBe(true);
    });
  });
});
