import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {electra} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";

const isValidDepositSignatureMock = vi.hoisted(() =>
  vi.fn(
    (
      _config: unknown,
      _pubkey: Uint8Array,
      _withdrawalCredentials: Uint8Array,
      _amount: number,
      signature: Uint8Array
    ) => signature[0] === 1
  )
);

vi.mock("../../../src/block/processDeposit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/block/processDeposit.js")>();
  return {
    ...actual,
    isValidDepositSignature: isValidDepositSignatureMock,
  };
});

const {PendingDepositsLookup} = await import("../../../src/util/pendingDepositsLookup.js");
const {BuilderDepositSignatureCache} = await import("../../../src/cache/builderDepositSignatureCache.js");

describe("PendingDepositsLookup", () => {
  const config = createBeaconConfig(chainConfig, Buffer.alloc(32));
  // Read-only in these tests (hasPendingValidator never writes) and stays empty → always misses,
  // so signature checks fall through to the (mocked) isValidDepositSignature as before.
  const emptyCache = new BuilderDepositSignatureCache();

  beforeEach(() => {
    isValidDepositSignatureMock.mockClear();
  });

  function createPendingDeposit(pubkeySeed: number, signatureSeed: number): electra.PendingDeposit {
    return {
      pubkey: Buffer.alloc(48, pubkeySeed),
      withdrawalCredentials: Buffer.alloc(32),
      amount: 32_000_000_000,
      signature: Buffer.alloc(96, signatureSeed),
      slot: 0,
    };
  }

  it("returns false for an empty lookup without checking signatures", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const pubkeyHex = toPubkeyHex(createPendingDeposit(1, 0).pubkey);

    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).not.toHaveBeenCalled();
  });

  it("memoizes a false result when no deposits are appended", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const deposit0 = createPendingDeposit(1, 0);
    const deposit1 = createPendingDeposit(1, 0);
    const pubkeyHex = toPubkeyHex(deposit0.pubkey);

    lookup.add(deposit0, pubkeyHex);
    lookup.add(deposit1, pubkeyHex);

    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);
  });

  it("validates only newly appended deposits after a cached false result", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const deposit0 = createPendingDeposit(1, 0);
    const deposit1 = createPendingDeposit(1, 0);
    const deposit2 = createPendingDeposit(1, 1);
    const pubkeyHex = toPubkeyHex(deposit0.pubkey);

    lookup.add(deposit0, pubkeyHex);
    lookup.add(deposit1, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    lookup.add(deposit2, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(3);
    expect(isValidDepositSignatureMock).toHaveBeenLastCalledWith(
      config,
      deposit2.pubkey,
      deposit2.withdrawalCredentials,
      deposit2.amount,
      deposit2.signature
    );
  });

  it("does not validate appended deposits after a valid signature is cached", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const deposit0 = createPendingDeposit(1, 0);
    const deposit1 = createPendingDeposit(1, 1);
    const deposit2 = createPendingDeposit(1, 0);
    const pubkeyHex = toPubkeyHex(deposit0.pubkey);

    lookup.add(deposit0, pubkeyHex);
    lookup.add(deposit1, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    lookup.add(deposit2, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex, emptyCache)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);
  });

  it("caches validation independently for each pubkey", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const depositA = createPendingDeposit(1, 0);
    const depositB = createPendingDeposit(2, 1);
    const pubkeyHexA = toPubkeyHex(depositA.pubkey);
    const pubkeyHexB = toPubkeyHex(depositB.pubkey);

    lookup.add(depositA, pubkeyHexA);
    lookup.add(depositB, pubkeyHexB);

    expect(lookup.hasPendingValidator(config, pubkeyHexA, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(1);

    expect(lookup.hasPendingValidator(config, pubkeyHexB, emptyCache)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    expect(lookup.hasPendingValidator(config, pubkeyHexA, emptyCache)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);
  });

  it("uses the pre-verify cache instead of BLS when the deposits are already verified", () => {
    // Scenario 5: many same-pubkey validator deposits pre-verified invalid in the cache. At the fork
    // hasPendingValidator must read the cache and return false without a single BLS check.
    const lookup = PendingDepositsLookup.buildEmpty();
    const cache = new BuilderDepositSignatureCache();
    const deposits = Array.from({length: 40}, () => createPendingDeposit(1, 0)); // all for pubkey 1, invalid
    const pubkeyHex = toPubkeyHex(deposits[0].pubkey);

    for (const deposit of deposits) {
      lookup.add(deposit, pubkeyHex);
      cache.setSignatureValidity(deposit, false); // pre-verified invalid
    }

    expect(lookup.hasPendingValidator(config, pubkeyHex, cache)).toBe(false);
    expect(isValidDepositSignatureMock).not.toHaveBeenCalled();
  });
});
