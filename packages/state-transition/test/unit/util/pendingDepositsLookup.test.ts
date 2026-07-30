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

describe("PendingDepositsLookup", () => {
  const config = createBeaconConfig(chainConfig, Buffer.alloc(32));

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

    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(false);
    expect(isValidDepositSignatureMock).not.toHaveBeenCalled();
  });

  it("memoizes a false result when no deposits are appended", () => {
    const lookup = PendingDepositsLookup.buildEmpty();
    const deposit0 = createPendingDeposit(1, 0);
    const deposit1 = createPendingDeposit(1, 0);
    const pubkeyHex = toPubkeyHex(deposit0.pubkey);

    lookup.add(deposit0, pubkeyHex);
    lookup.add(deposit1, pubkeyHex);

    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(false);
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
    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    lookup.add(deposit2, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(true);
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
    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    lookup.add(deposit2, pubkeyHex);
    expect(lookup.hasPendingValidator(config, pubkeyHex)).toBe(true);
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

    expect(lookup.hasPendingValidator(config, pubkeyHexA)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(1);

    expect(lookup.hasPendingValidator(config, pubkeyHexB)).toBe(true);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);

    expect(lookup.hasPendingValidator(config, pubkeyHexA)).toBe(false);
    expect(isValidDepositSignatureMock).toHaveBeenCalledTimes(2);
  });
});
