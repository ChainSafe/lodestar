import {describe, expect, it} from "vitest";
import {electra, ssz} from "@lodestar/types";
import {BuilderDepositSignatureCache} from "../../../src/cache/builderDepositSignatureCache.js";

function createPendingDeposit(pubkeySeed: number, signatureSeed: number): electra.PendingDeposit {
  return {
    pubkey: Buffer.alloc(48, pubkeySeed),
    withdrawalCredentials: Buffer.alloc(32),
    amount: 32_000_000_000,
    signature: Buffer.alloc(96, signatureSeed),
    slot: 0,
  };
}

function pendingDepositsList(...deposits: electra.PendingDeposit[]) {
  const list = ssz.electra.PendingDeposits.defaultViewDU();
  for (const deposit of deposits) {
    list.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
  list.commit();
  return list;
}

describe("BuilderDepositSignatureCache", () => {
  it("caches signature validity keyed by deposit value-object identity", () => {
    const list = pendingDepositsList(createPendingDeposit(1, 1), createPendingDeposit(2, 2));
    const [a, b] = list.getAllReadonlyValues();
    const unseen = createPendingDeposit(3, 3); // never inserted into the cache

    const cache = new BuilderDepositSignatureCache();
    cache.setSignatureValidity(a, true);
    cache.setSignatureValidity(b, false);

    expect(cache.getSignatureValidity(a)).toBe(true);
    expect(cache.getSignatureValidity(b)).toBe(false);
    // null (not `false`) means "not yet verified" — the contract onboarding relies on
    expect(cache.getSignatureValidity(unseen)).toBeNull();
    expect(cache.isVerified(a)).toBe(true);
    expect(cache.isVerified(unseen)).toBe(false);
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.isVerified(a)).toBe(false);
    expect(cache.getSignatureValidity(a)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("getAllReadonlyValues() returns reference-equal structs across calls (value-identity assumption)", () => {
    // For a ContainerNodeStructType, tree_toValue(node) returns node.value by reference, so repeated
    // reads of an unchanged list yield the same struct object — the basis for identity-keying the cache
    // across prepareNextSlot-derived states and the gloas pendingDeposits migration.
    const list = pendingDepositsList(createPendingDeposit(1, 1));
    const first = list.getAllReadonlyValues();
    const second = list.getAllReadonlyValues();
    expect(second[0]).toBe(first[0]);
    // getReadonly(i).toValue() (the consumer path in onboardBuildersFromPendingDeposits) resolves to
    // the same node.value reference as getAllReadonlyValues()[i] (the scanner path) — the invariant
    // that lets the cache hit across the two.
    expect(list.getReadonly(0).toValue()).toBe(first[0]);
  });
});
