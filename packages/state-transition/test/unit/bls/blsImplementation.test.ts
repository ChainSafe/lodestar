import {describe, expect, it} from "vitest";
import {
  ACTIVE_BLS_IMPLEMENTATION,
  BlsImplementation,
  SecretKey,
  aggregatePublicKeys,
  createPubkeyCache,
} from "../../../src/bls/index.js";

describe("BLS implementation", () => {
  it("uses blst and isolated pubkey caches by default", () => {
    expect(ACTIVE_BLS_IMPLEMENTATION).toBe(BlsImplementation.blst);
    expect(createPubkeyCache()).not.toBe(createPubkeyCache());
  });

  it("provides the extended cache API with the original implementation", () => {
    const cache = createPubkeyCache();
    const publicKeys = [1, 2].map((value) => SecretKey.fromBytes(Buffer.alloc(32, value)).toPublicKey());
    publicKeys.forEach((publicKey, index) => cache.set(index, publicKey.toBytes()));

    expect(cache.aggregate([0, 1]).toBytes()).toEqual(aggregatePublicKeys(publicKeys).toBytes());
    expect(() => cache.ensureCapacity(10)).not.toThrow();
    cache.reset();
    expect(cache.size).toBe(0);
  });
});
