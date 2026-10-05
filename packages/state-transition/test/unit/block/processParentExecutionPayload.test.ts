import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  MIN_DEPOSIT_AMOUNT,
  PAYLOAD_BUILDER_VERSION,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {applyParentExecutionPayload} from "../../../src/block/processParentExecutionPayload.js";
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
});
