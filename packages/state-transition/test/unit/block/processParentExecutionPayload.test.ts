import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  MIN_DEPOSIT_AMOUNT,
  PAYLOAD_BUILDER_VERSION,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  applyParentExecutionPayload,
  processParentExecutionPayload,
} from "../../../src/block/processParentExecutionPayload.js";
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

describe("processParentExecutionPayload", () => {
  const parentSlot = 3;
  const parentBlockHash = Buffer.alloc(32, 4);
  const parentPayloadRoot = Buffer.alloc(32, 6);
  const latestBlockHash = Buffer.alloc(32, 7);
  const latestPayloadRoot = Buffer.alloc(32, 8);

  /** State whose latest block committed to `parentBlockHash` and `parentPayloadRoot`, its payload is not applied */
  function buildState(): CachedBeaconStateGloas {
    const state = buildStateWithEvictedPayment(0);
    state.latestExecutionPayloadBid.payloadRoot = parentPayloadRoot;
    state.latestExecutionPayloadBid.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(
      ssz.gloas.ExecutionRequests.defaultValue()
    );
    state.latestBlockHash = latestBlockHash;
    state.latestPayloadRoot = latestPayloadRoot;
    state.commit();
    return state;
  }

  function buildBlock(bid: {parentBlockHash: Uint8Array; parentPayloadRoot: Uint8Array}): gloas.BeaconBlock {
    const block = ssz.gloas.BeaconBlock.defaultValue();
    block.body.signedExecutionPayloadBid.message.parentBlockHash = bid.parentBlockHash;
    block.body.signedExecutionPayloadBid.message.parentPayloadRoot = bid.parentPayloadRoot;
    return block;
  }

  it("treats the parent as EMPTY if the bid has the parent's block hash but another parent payload root", () => {
    const state = buildState();
    const block = buildBlock({parentBlockHash, parentPayloadRoot: Buffer.alloc(32, 9)});

    processParentExecutionPayload(state, block);

    expect(toRootHex(state.latestBlockHash)).toBe(toRootHex(latestBlockHash));
    expect(toRootHex(state.latestPayloadRoot)).toBe(toRootHex(latestPayloadRoot));
    expect(state.executionPayloadAvailability.get(parentSlot % SLOTS_PER_HISTORICAL_ROOT)).toBe(false);

    // no execution requests are expected of an EMPTY parent
    block.body.parentExecutionRequests = exitRequestFor(state);
    expect(() => processParentExecutionPayload(state, block)).toThrow(
      "Parent execution requests must be empty when parent block is EMPTY"
    );
  });

  it("treats the parent as FULL if the bid has the parent's payload root but another parent block hash", () => {
    const state = buildState();
    const block = buildBlock({parentBlockHash: Buffer.alloc(32, 9), parentPayloadRoot});

    processParentExecutionPayload(state, block);

    // the latest block hash and the latest payload root are written together
    expect(toRootHex(state.latestBlockHash)).toBe(toRootHex(parentBlockHash));
    expect(toRootHex(state.latestPayloadRoot)).toBe(toRootHex(parentPayloadRoot));
    expect(state.executionPayloadAvailability.get(parentSlot % SLOTS_PER_HISTORICAL_ROOT)).toBe(true);
  });
});
