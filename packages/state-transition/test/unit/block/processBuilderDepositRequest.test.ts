import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BUILDER_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  ForkName,
  PAYLOAD_BUILDER_VERSION,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";

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
const {createCachedBeaconState, createPubkeyCache} = await import("../../../src/index.js");

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
      pubkeyCache: createPubkeyCache(),
    },
    {skipSyncCommitteeCache: true}
  );
}

function makeBuilderWithdrawalCredentials(
  executionAddress: Uint8Array,
  prefix = BUILDER_WITHDRAWAL_PREFIX
): Uint8Array {
  const creds = new Uint8Array(32);
  creds[0] = prefix;
  creds.set(executionAddress, 12);
  return creds;
}

function makeBuilderDepositRequest({
  pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1),
  executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1),
  amount = 1_000_000_000,
  signatureFirstByte = 1, // 1 => valid via mock, anything else => invalid
  withdrawalCredentials,
  prefix = BUILDER_WITHDRAWAL_PREFIX,
}: {
  pubkey?: Uint8Array;
  executionAddress?: Uint8Array;
  amount?: number;
  signatureFirstByte?: number;
  withdrawalCredentials?: Uint8Array;
  prefix?: number;
} = {}) {
  const signature = new Uint8Array(96);
  signature[0] = signatureFirstByte;
  return {
    pubkey,
    withdrawalCredentials: withdrawalCredentials ?? makeBuilderWithdrawalCredentials(executionAddress, prefix),
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
    expect(builder.version).toBe(PAYLOAD_BUILDER_VERSION);
    expect(builder.withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("drops a new builder request when the withdrawal credentials prefix is not the builder prefix", () => {
    const state = buildGloasState(1);
    const request = makeBuilderDepositRequest({prefix: 0x01});

    processBuilderDepositRequest(state, request);

    expect(isValidBuilderDepositSignatureMock).not.toHaveBeenCalled();
    expect(state.builders.length).toBe(0);
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

    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress: originalAddress,
        balance: 32_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );

    // Attacker-shaped top-up: same pubkey but different (would-be) execution address. Valid
    // top-ups must ignore the request's execution address and signature.
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
    expect(builder.version).toBe(PAYLOAD_BUILDER_VERSION);
  });

  it("drops a top-up when the withdrawal credentials prefix is not the builder prefix", () => {
    const state = buildGloasState(SLOTS_PER_EPOCH);
    const pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1);
    const executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1);

    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress,
        balance: 32_000_000_000,
        depositEpoch: 0,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );

    const request = makeBuilderDepositRequest({
      pubkey,
      amount: 1_000_000_000,
      prefix: 0x01,
    });

    processBuilderDepositRequest(state, request);

    expect(isValidBuilderDepositSignatureMock).not.toHaveBeenCalled();
    expect(state.builders.length).toBe(1);
    const builder = state.builders.get(0);
    expect(builder.balance).toBe(32_000_000_000);
    expect(builder.executionAddress).toEqual(executionAddress);
    expect(builder.version).toBe(PAYLOAD_BUILDER_VERSION);
  });

  it("resets the withdrawable epoch when topping up an exited, fully-swept builder", () => {
    const slot = SLOTS_PER_EPOCH * 2;
    const state = buildGloasState(slot);
    const pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1);
    const executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1);

    // Exited and fully swept builder: finite withdrawableEpoch, zero balance
    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: PAYLOAD_BUILDER_VERSION,
        executionAddress,
        balance: 0,
        depositEpoch: 0,
        withdrawableEpoch: 1,
      })
    );

    const request = makeBuilderDepositRequest({pubkey, executionAddress, amount: 1_000_000_000});

    processBuilderDepositRequest(state, request);

    const builder = state.builders.get(0);
    expect(builder.balance).toBe(1_000_000_000);
    const currentEpoch = Math.floor(slot / SLOTS_PER_EPOCH);
    expect(builder.withdrawableEpoch).toBe(currentEpoch + state.config.MIN_BUILDER_WITHDRAWABILITY_DELAY);
  });

  it("does not reset the withdrawable epoch when topping up an exited builder with nonzero balance", () => {
    const slot = SLOTS_PER_EPOCH * 2;
    const state = buildGloasState(slot);
    const pubkey = Uint8Array.from({length: 48}, (_, i) => i + 1);
    const executionAddress = Uint8Array.from({length: 20}, (_, i) => i + 1);

    // Exited builder that has NOT been swept: finite withdrawableEpoch, nonzero balance.
    // Per spec, the reset is gated on balance == 0, so the withdrawableEpoch must be preserved.
    state.builders.push(
      ssz.gloas.Builder.toViewDU({
        pubkey,
        version: PAYLOAD_BUILDER_VERSION,
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
    expect(builder.withdrawableEpoch).toBe(1);
  });
});
