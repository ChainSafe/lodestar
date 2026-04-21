import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {processExecutionPayloadEnvelope} from "../../../src/block/processExecutionPayloadEnvelope.js";
import {computeTimeAtSlot} from "../../../src/util/index.js";

describe("processExecutionPayloadEnvelope", () => {
  function setupStateAndEnvelope(expectedWithdrawals = [ssz.capella.Withdrawal.defaultValue()]) {
    const config = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });

    const headerRoot = new Uint8Array(32).fill(0x44);
    const stateRoot = new Uint8Array(32).fill(0x55);
    const prevRandao = new Uint8Array(32).fill(0x11);
    const parentHash = new Uint8Array(32).fill(0x22);
    const blockHash = new Uint8Array(32).fill(0x33);
    const expectedWithdrawalsRoot = ssz.capella.Withdrawals.hashTreeRoot(expectedWithdrawals);

    const postState: any = {
      config,
      slot: 1,
      genesisTime: 0,
      hashTreeRoot: vi.fn(() => stateRoot),
      latestBlockHeader: {
        stateRoot,
        proposerIndex: 0,
        hashTreeRoot: vi.fn(() => headerRoot),
      },
      latestExecutionPayloadBid: {
        builderIndex: 7,
        prevRandao,
        gasLimit: 123456,
        blockHash,
      },
      payloadExpectedWithdrawals: {
        hashTreeRoot: vi.fn(() => expectedWithdrawalsRoot),
      },
      latestBlockHash: parentHash,
      builderPendingPayments: {
        get: vi.fn(() => ({clone: () => ({withdrawal: {amount: 0}})})),
        set: vi.fn(),
      },
      builderPendingWithdrawals: {
        push: vi.fn(),
      },
      executionPayloadAvailability: {
        set: vi.fn(),
      },
      commit: vi.fn(),
      clone: vi.fn(),
    };
    postState.clone.mockReturnValue(postState);

    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.slot = postState.slot;
    signedEnvelope.message.builderIndex = postState.latestExecutionPayloadBid.builderIndex;
    signedEnvelope.message.beaconBlockRoot = headerRoot;
    signedEnvelope.message.stateRoot = stateRoot;
    signedEnvelope.message.payload.prevRandao = prevRandao;
    signedEnvelope.message.payload.parentHash = parentHash;
    signedEnvelope.message.payload.blockHash = blockHash;
    signedEnvelope.message.payload.gasLimit = postState.latestExecutionPayloadBid.gasLimit;
    signedEnvelope.message.payload.timestamp = computeTimeAtSlot(config, postState.slot, postState.genesisTime);
    signedEnvelope.message.payload.withdrawals = expectedWithdrawals;

    return {state: postState, signedEnvelope, blockHash};
  }

  it("accepts a payload whose withdrawals root matches state.payloadExpectedWithdrawals", () => {
    const {state, signedEnvelope, blockHash} = setupStateAndEnvelope();

    const result = processExecutionPayloadEnvelope(state, signedEnvelope, {
      verifySignature: false,
      verifyStateRoot: false,
    });

    expect(result.latestBlockHash).toEqual(blockHash);
    expect(result.executionPayloadAvailability.set).toHaveBeenCalledWith(result.slot % 8192, true);
    expect(result.commit).toHaveBeenCalled();
    expect(result.payloadExpectedWithdrawals.hashTreeRoot).toHaveBeenCalled();
  });

  it("throws when payload withdrawals differ from state.payloadExpectedWithdrawals", () => {
    const expectedWithdrawals = [ssz.capella.Withdrawal.defaultValue()];
    const {state, signedEnvelope} = setupStateAndEnvelope(expectedWithdrawals);
    signedEnvelope.message.payload.withdrawals = [];

    expect(() =>
      processExecutionPayloadEnvelope(state, signedEnvelope, {
        verifySignature: false,
        verifyStateRoot: false,
      })
    ).toThrow(/Withdrawals mismatch between payload and expected withdrawals/);
  });
});
