import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {BUILDER_WITHDRAWAL_PREFIX, FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {pubkeyCache} from "../../../src/bls/index.js";

const isValidBuilderDepositSignatureMock = vi.hoisted(() =>
  // Treat the first byte of the BLS signature as the verification flag so each test can opt in
  // or out of PoP success without performing real BLS arithmetic. Mirrors the real positional
  // signature: (config, pubkey, withdrawalCredentials, amount, signature).
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

vi.mock("../../../src/util/gloas.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/util/gloas.js")>();
  return {
    ...actual,
    isValidBuilderDepositSignature: isValidBuilderDepositSignatureMock,
  };
});

const {processBuilderDepositRequest} = await import("../../../src/block/processBuilderDepositRequest.js");
const {createCachedBeaconState} = await import("../../../src/index.js");

function buildGloasState(slot = 0) {
  const config = getConfig(ForkName.gloas);
  const view = ssz.gloas.BeaconState.defaultViewDU();
  view.slot = slot;
  view.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GENESIS_FORK_VERSION,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: 0,
  });
  return createCachedBeaconState(
    view,
    {
      config: createBeaconConfig(config, view.genesisValidatorsRoot),
      pubkeyCache,
    },
    {skipSyncCommitteeCache: true}
  );
}

function makeBuilderWithdrawalCredentials(executionAddress: Uint8Array): Uint8Array {
  const creds = new Uint8Array(32);
  creds[0] = BUILDER_WITHDRAWAL_PREFIX;
  creds.set(executionAddress, 12);
  return creds;
}

function makeBuilderDepositRequest({
  pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1),
  executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1),
  amount = 1_000_000_000,
  signatureFirstByte = 1, // 1 => valid via mock, anything else => invalid
}: {
  pubkey?: Uint8Array;
  executionAddress?: Uint8Array;
  amount?: number;
  signatureFirstByte?: number;
} = {}) {
  const signature = new Uint8Array(96);
  signature[0] = signatureFirstByte;
  return {
    pubkey,
    withdrawalCredentials: makeBuilderWithdrawalCredentials(executionAddress),
    amount,
    signature,
  };
}

describe("processBuilderDepositRequest", () => {
  beforeEach(() => {
    isValidBuilderDepositSignatureMock.mockClear();
  });

  it("registers a new builder when PoP is valid", () => {
    const state = buildGloasState(1);
    const request = makeBuilderDepositRequest({amount: 32_000_000_000});

    expect(state.builders.length).toBe(0);

    processBuilderDepositRequest(state, request);

    expect(isValidBuilderDepositSignatureMock).toHaveBeenCalledTimes(1);
    expect(state.builders.length).toBe(1);
    const builder = state.builders.get(0);
    expect(builder.balance).toBe(32_000_000_000);
    expect(builder.executionAddress).toEqual(request.withdrawalCredentials.subarray(12));
    expect(builder.version).toBe(BUILDER_WITHDRAWAL_PREFIX);
    expect(builder.withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("drops the request when PoP is invalid", () => {
    const state = buildGloasState(1);
    const request = makeBuilderDepositRequest({signatureFirstByte: 0});

    processBuilderDepositRequest(state, request);

    expect(isValidBuilderDepositSignatureMock).toHaveBeenCalledTimes(1);
    expect(state.builders.length).toBe(0);
  });

  it("tops up an existing builder without re-verifying signature or rebinding withdrawal credentials", () => {
    const state = buildGloasState(SLOTS_PER_EPOCH);
    const pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1);
    const originalAddress = Uint8Array.from({length: 20}, (_, i) => i + 1);
    const originalCreds = makeBuilderWithdrawalCredentials(originalAddress);

    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: originalCreds[0],
        executionAddress: originalAddress,
        balance: 32_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );

    // Attacker-shaped top-up: same pubkey but different (would-be) execution address. Top-ups
    // must ignore the request's withdrawal credentials and signature entirely.
    const attackerAddress = Uint8Array.from({length: 20}, () => 0xff);
    const request = makeBuilderDepositRequest({
      pubkey,
      executionAddress: attackerAddress,
      amount: 1_000_000_000,
      signatureFirstByte: 0, // would be rejected as invalid PoP, but mustn't be checked
    });

    processBuilderDepositRequest(state, request);

    expect(isValidBuilderDepositSignatureMock).not.toHaveBeenCalled();
    expect(state.builders.length).toBe(1);
    const builder = state.builders.get(0);
    expect(builder.balance).toBe(33_000_000_000);
    expect(builder.executionAddress).toEqual(originalAddress);
    expect(builder.version).toBe(BUILDER_WITHDRAWAL_PREFIX);
  });

  it("resets the withdrawable epoch when topping up an exited builder", () => {
    const slot = SLOTS_PER_EPOCH * 2;
    const state = buildGloasState(slot);
    const pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1);
    const executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1);

    // Exited builder: finite withdrawableEpoch
    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: BUILDER_WITHDRAWAL_PREFIX,
        executionAddress,
        balance: 1_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: 1,
      })
    );

    const request = makeBuilderDepositRequest({pubkey, executionAddress, amount: 1_000_000_000});

    processBuilderDepositRequest(state, request);

    const builder = state.builders.get(0);
    expect(builder.balance).toBe(2_000_000_000);
    const currentEpoch = Math.floor(slot / SLOTS_PER_EPOCH);
    expect(builder.withdrawableEpoch).toBe(currentEpoch + state.config.MIN_BUILDER_WITHDRAWABILITY_DELAY);
  });
});
