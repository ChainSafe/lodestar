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
    it("defaults to 0", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.lastVerifiedSlot).toBe(0);
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

  describe("setVerifiedPreGloas + isVerifiedPreGloas", () => {
    it("returns false for an unseen deposit", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.isVerifiedPreGloas(atSlot(pool[0], 5))).toBe(false);
    });

    it("returns true after setVerifiedPreGloas on the same (slot, content)", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setVerifiedPreGloas(d);
      expect(cache.isVerifiedPreGloas(d)).toBe(true);
    });

    it("returns false when a different deposit at the same slot is queried", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setVerifiedPreGloas(atSlot(pool[0], 5));
      // Same slot, different pubkey → root differs → not in cache
      expect(cache.isVerifiedPreGloas(atSlot(pool[1], 5))).toBe(false);
    });

    it("returns false when the same content is queried at a different slot", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setVerifiedPreGloas(atSlot(pool[0], 5));
      // Slot is the outer Map key (not part of the inner hash); querying a different slot
      // looks up a different bucket → miss.
      expect(cache.isVerifiedPreGloas(atSlot(pool[0], 6))).toBe(false);
    });

    it("distinguishes two deposits with same pubkey/slot but different signatures", () => {
      const cache = new BuilderDepositSignatureCache();
      const d1 = atSlot(pool[0], 5);
      const d2: electra.PendingDeposit = {...d1, signature: Buffer.alloc(96, 0xff)};
      cache.setVerifiedPreGloas(d1);
      expect(cache.isVerifiedPreGloas(d1)).toBe(true);
      expect(cache.isVerifiedPreGloas(d2)).toBe(false);
    });

    it("holds entries across multiple slots independently", () => {
      const cache = new BuilderDepositSignatureCache();
      const d5 = atSlot(pool[0], 5);
      const d6 = atSlot(pool[1], 6);
      cache.setVerifiedPreGloas(d5);
      cache.setVerifiedPreGloas(d6);
      expect(cache.isVerifiedPreGloas(d5)).toBe(true);
      expect(cache.isVerifiedPreGloas(d6)).toBe(true);
    });
  });

  describe("clearPreGloasCache", () => {
    it("empties the verified-roots map and resets lastVerifiedSlot to 0", () => {
      const cache = new BuilderDepositSignatureCache();
      const d = atSlot(pool[0], 5);
      cache.setVerifiedPreGloas(d);
      cache.lastVerifiedSlot = 42;

      cache.clearPreGloasCache();

      expect(cache.lastVerifiedSlot).toBe(0);
      expect(cache.isVerifiedPreGloas(d)).toBe(false);
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
      cache.setVerifiedByPayload(hashA, pool[0]);

      cache.clearPreGloasCache();

      // Survives clear — payload sub-cache is self-rolling, not tied to fork transition
      expect(cache.isVerifiedByPayload(hashA, pool[0])).toBe(true);
    });
  });

  describe("setVerifiedByPayload + isVerifiedByPayload", () => {
    const hashA = "0xaa".padEnd(66, "a");
    const hashB = "0xbb".padEnd(66, "b");

    it("returns false for an unseen (payloadBlockHash, deposit) pair", () => {
      const cache = new BuilderDepositSignatureCache();
      expect(cache.isVerifiedByPayload(hashA, pool[0])).toBe(false);
    });

    it("returns true after setVerifiedByPayload on the same key + content", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setVerifiedByPayload(hashA, pool[0]);
      expect(cache.isVerifiedByPayload(hashA, pool[0])).toBe(true);
    });

    it("ignores the deposit.slot field (PendingDepositNoSlot type excludes slot from identity)", () => {
      const cache = new BuilderDepositSignatureCache();
      // The payload-keyed surface takes PendingDepositNoSlot. PendingDeposit (with slot)
      // is structurally assignable, and the SSZ type hashes only the 4 slot-less fields,
      // so a producer and consumer disagreeing on `slot` still hit.
      cache.setVerifiedByPayload(hashA, atSlot(pool[0], 0));
      expect(cache.isVerifiedByPayload(hashA, atSlot(pool[0], 42))).toBe(true);
    });

    it("isolates entries between different payloadBlockHash keys", () => {
      const cache = new BuilderDepositSignatureCache();
      cache.setVerifiedByPayload(hashA, pool[0]);
      expect(cache.isVerifiedByPayload(hashB, pool[0])).toBe(false);
    });

    it("multiple deposits under the same key do not grow the underlying Map", () => {
      const cache = new BuilderDepositSignatureCache();
      // 5 distinct deposits under one payload — should still occupy a single Map entry
      for (let i = 0; i < 5; i++) cache.setVerifiedByPayload(hashA, pool[i]);
      for (let i = 0; i < 5; i++) {
        expect(cache.isVerifiedByPayload(hashA, pool[i])).toBe(true);
      }
    });

    it("evicts the oldest payloadBlockHash when the 32-entry cap is exceeded", () => {
      const cache = new BuilderDepositSignatureCache();
      const keys: string[] = [];
      // Insert 33 distinct payload blockHashes, each with one deposit (recycle pool[0]).
      for (let i = 0; i < 33; i++) {
        const k = `0x${i.toString(16).padStart(64, "0")}`;
        keys.push(k);
        cache.setVerifiedByPayload(k, pool[0]);
      }
      // The first inserted key was evicted; the remaining 32 are still queryable.
      expect(cache.isVerifiedByPayload(keys[0], pool[0])).toBe(false);
      for (let i = 1; i < 33; i++) {
        expect(cache.isVerifiedByPayload(keys[i], pool[0])).toBe(true);
      }
    });
  });
});
