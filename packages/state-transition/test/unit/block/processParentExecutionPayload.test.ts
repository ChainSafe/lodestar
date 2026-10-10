import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_WITHDRAWALS_PER_PAYLOAD,
  MIN_DEPOSIT_AMOUNT,
  PAYLOAD_BUILDER_VERSION,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {applyParentExecutionPayload} from "../../../src/block/processParentExecutionPayload.js";
import {getExpectedWithdrawals, processWithdrawals} from "../../../src/block/processWithdrawals.js";
import {slashValidator} from "../../../src/block/slashValidator.js";
import {createCachedBeaconState} from "../../../src/index.js";
import {CachedBeaconStateGloas} from "../../../src/types.js";
import {getPendingBalanceToWithdrawForBuilder, isActiveBuilder} from "../../../src/util/gloas.js";

const builderIndex = 0;
const bidValue = 100_000_000;

/**
 * State at the start of epoch 2 whose latest block is a slot 3 builder block. The payment for
 * that block was evicted from builderPendingPayments by the two epoch transitions in between.
 */
function buildStateWithEvictedPayment(value: number): CachedBeaconStateGloas {
  const config = getConfig(ForkName.gloas);
  const view = ssz.gloas.BeaconState.defaultViewDU();
  view.slot = 2 * SLOTS_PER_EPOCH;
  view.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GENESIS_FORK_VERSION,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: 0,
  });
  view.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: 1, root: new Uint8Array(32)});
  view.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
    ...ssz.phase0.BeaconBlockHeader.defaultValue(),
    slot: 3,
  });
  view.validators.push(
    ssz.phase0.Validator.toViewDU({
      ...ssz.phase0.Validator.defaultValue(),
      pubkey: SecretKey.fromBytes(Buffer.alloc(32, 1)).toPublicKey().toBytes(),
      activationEpoch: 0,
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    })
  );
  view.balances.push(MAX_EFFECTIVE_BALANCE);
  view.previousEpochParticipation.push(0);
  view.currentEpochParticipation.push(0);
  view.builders.push(
    ssz.gloas.Builder.toViewDU({
      pubkey: Buffer.alloc(48, 1),
      version: PAYLOAD_BUILDER_VERSION,
      executionAddress: Buffer.alloc(20, 2),
      balance: 2 * MIN_DEPOSIT_AMOUNT,
      depositEpoch: 0,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    })
  );
  view.latestExecutionPayloadBid = ssz.gloas.ExecutionPayloadBid.toViewDU({
    ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
    parentBlockHash: Buffer.alloc(32, 3),
    blockHash: Buffer.alloc(32, 4),
    builderIndex,
    slot: 3,
    value,
    feeRecipient: Buffer.alloc(20, 5),
  });
  view.commit();
  return createCachedBeaconState(
    view,
    {config: createBeaconConfig(config, view.genesisValidatorsRoot), pubkeyCache},
    {skipSyncCommitteeCache: true}
  ) as CachedBeaconStateGloas;
}

function exitRequestFor(state: CachedBeaconStateGloas): gloas.ExecutionRequests {
  const builder = state.builders.getReadonly(builderIndex);
  return {
    ...ssz.gloas.ExecutionRequests.defaultValue(),
    builderExits: [{sourceAddress: builder.executionAddress, pubkey: builder.pubkey}],
  };
}

describe("applyParentExecutionPayload", () => {
  it("does not debit the builder when slashing clears an unqueued payment", () => {
    const state = buildStateWithEvictedPayment(bidValue);
    state.latestBlockHeader.slot = state.slot;
    state.latestExecutionPayloadBid.slot = state.slot;
    const withdrawal = {
      amount: bidValue,
      builderIndex,
      feeRecipient: state.latestExecutionPayloadBid.feeRecipient,
    };
    state.builderPendingPayments.set(
      SLOTS_PER_EPOCH,
      ssz.gloas.BuilderPendingPayment.toViewDU({proposerIndex: 0, weight: 1, withdrawal})
    );
    const balance = state.builders.getReadonly(builderIndex).balance;

    slashValidator(ForkSeq.gloas, state, 0);
    state.commit();

    expect(state.validators.getReadonly(0).slashed).toBe(true);
    expect(state.builderPendingPayments.getReadonly(SLOTS_PER_EPOCH).withdrawal.amount).toBe(0);
    expect(state.builderPendingWithdrawals.length).toBe(0);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(balance);
  });

  it("does not cancel an already queued payment when its proposer is slashed", () => {
    const state = buildStateWithEvictedPayment(bidValue);
    const balance = state.builders.getReadonly(builderIndex).balance;
    const withdrawal = {
      amount: bidValue,
      builderIndex,
      feeRecipient: state.latestExecutionPayloadBid.feeRecipient,
    };
    for (let i = 0; i < MAX_WITHDRAWALS_PER_PAYLOAD - 1; i++) {
      state.builderPendingWithdrawals.push(ssz.gloas.BuilderPendingWithdrawal.toViewDU(withdrawal));
    }
    applyParentExecutionPayload(state, ssz.gloas.ExecutionRequests.defaultValue());
    processWithdrawals(ForkSeq.gloas, state);
    state.commit();
    const balanceAfterEarlierPayments = balance - (MAX_WITHDRAWALS_PER_PAYLOAD - 1) * bidValue;
    expect(state.builderPendingWithdrawals.getAllReadonlyValues()).toEqual([withdrawal]);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(balanceAfterEarlierPayments);

    slashValidator(ForkSeq.gloas, state, 0);
    state.commit();

    expect(state.builderPendingWithdrawals.getAllReadonlyValues()).toEqual([withdrawal]);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(balanceAfterEarlierPayments);
    state.slot++;
    processWithdrawals(ForkSeq.gloas, state);
    state.commit();
    expect(state.builderPendingWithdrawals.length).toBe(0);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(balanceAfterEarlierPayments - bidValue);
  });

  it("rejects a builder exit request while the evicted payment is re-added", () => {
    const state = buildStateWithEvictedPayment(bidValue);
    expect(isActiveBuilder(state.builders.getReadonly(builderIndex), state.finalizedCheckpoint.epoch)).toBe(true);
    expect(getPendingBalanceToWithdrawForBuilder(state, builderIndex)).toBe(0);

    applyParentExecutionPayload(state, exitRequestFor(state));

    expect(state.builderPendingWithdrawals.length).toBe(1);
    expect(state.builderPendingWithdrawals.get(0).amount).toBe(bidValue);
    expect(state.builders.getReadonly(builderIndex).withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("accepts a builder exit request when the parent bid had no payment", () => {
    const state = buildStateWithEvictedPayment(0);

    applyParentExecutionPayload(state, exitRequestFor(state));

    expect(state.builderPendingWithdrawals.length).toBe(0);
    expect(state.builders.getReadonly(builderIndex).withdrawableEpoch).not.toBe(FAR_FUTURE_EPOCH);
  });

  it("defers an old parent payment behind an identical full withdrawal prefix", () => {
    const state = buildStateWithEvictedPayment(bidValue);
    const withdrawal = {
      amount: bidValue,
      builderIndex,
      feeRecipient: state.latestExecutionPayloadBid.feeRecipient,
    };
    for (let i = 0; i < MAX_WITHDRAWALS_PER_PAYLOAD - 1; i++) {
      state.builderPendingWithdrawals.push(ssz.gloas.BuilderPendingWithdrawal.toViewDU(withdrawal));
    }
    state.commit();
    const beforeBalance = state.builders.getReadonly(builderIndex).balance;
    applyParentExecutionPayload(state, ssz.gloas.ExecutionRequests.defaultValue());
    expect(state.builders.getReadonly(builderIndex).balance).toBe(beforeBalance);
    expect(state.builderPendingWithdrawals.length).toBe(MAX_WITHDRAWALS_PER_PAYLOAD);
    const firstExpected = getExpectedWithdrawals(ForkSeq.gloas, state);
    processWithdrawals(ForkSeq.gloas, state);
    state.commit();
    expect(firstExpected.processedBuilderWithdrawalsCount).toBe(MAX_WITHDRAWALS_PER_PAYLOAD - 1);
    expect(firstExpected.expectedWithdrawals.at(-1)?.index).toBe(MAX_WITHDRAWALS_PER_PAYLOAD - 2);
    expect(state.builderPendingWithdrawals.getAllReadonlyValues()).toEqual([withdrawal]);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(
      beforeBalance - (MAX_WITHDRAWALS_PER_PAYLOAD - 1) * bidValue
    );

    state.slot++;
    const secondExpected = getExpectedWithdrawals(ForkSeq.gloas, state);
    processWithdrawals(ForkSeq.gloas, state);
    state.commit();
    expect(secondExpected.processedBuilderWithdrawalsCount).toBe(1);
    expect(secondExpected.expectedWithdrawals[0].index).toBe(MAX_WITHDRAWALS_PER_PAYLOAD - 1);
    expect(state.builderPendingWithdrawals.length).toBe(0);
    expect(state.builders.getReadonly(builderIndex).balance).toBe(
      beforeBalance - MAX_WITHDRAWALS_PER_PAYLOAD * bidValue
    );
  });
});
