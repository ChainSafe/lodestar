import {MessageChannel, receiveMessageOnPort} from "node:worker_threads";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateGloas, BeaconStateView, createCachedBeaconState} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {generateState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("BeaconEngine API response serialization", () => {
  const checkpoints = {
    currentJustified: {epoch: 3, root: new Uint8Array(32).fill(3)},
    previousJustified: {epoch: 2, root: new Uint8Array(32).fill(2)},
    finalized: {epoch: 1, root: new Uint8Array(32).fill(1)},
  };
  const activeBuilder: gloas.Builder = {
    pubkey: new Uint8Array(48).fill(1),
    version: 1,
    executionAddress: new Uint8Array(20).fill(2),
    balance: 32_000_000_000,
    depositEpoch: 0,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  };
  const pendingBuilder: gloas.Builder = {
    ...activeBuilder,
    pubkey: new Uint8Array(48).fill(3),
    depositEpoch: 1,
  };
  const builderResponses = [
    {index: 0, status: "active", builder: activeBuilder},
    {index: 1, status: "pending", builder: pendingBuilder},
  ];
  const checkpoint = {...checkpoints.finalized, rootHex: toRootHex(checkpoints.finalized.root)};
  const getCheckpointStateOrBytes = vi.fn();
  let engine: BeaconEngine;
  let view: BeaconStateView;

  beforeEach(() => {
    const chainConfig = getConfig(ForkName.gloas, 0);
    const state = generateState(
      {
        slot: 3 * SLOTS_PER_EPOCH + 1,
        currentJustifiedCheckpoint: checkpoints.currentJustified,
        previousJustifiedCheckpoint: checkpoints.previousJustified,
        finalizedCheckpoint: checkpoints.finalized,
      },
      chainConfig,
      true
    ) as BeaconStateGloas;
    state.validators.get(1).effectiveBalance = 31_000_000_000;
    state.builders.push(ssz.gloas.Builder.toViewDU(activeBuilder));
    state.builders.push(ssz.gloas.Builder.toViewDU(pendingBuilder));
    state.commit();
    const config = createBeaconConfig(chainConfig, state.genesisValidatorsRoot);
    view = new BeaconStateView(createCachedBeaconState(state, {config, pubkeyCache}));
    const head = generateProtoBlock({slot: state.slot, executionStatus: ExecutionStatus.Syncing});
    engine = Object.assign(Object.create(BeaconEngine.prototype) as BeaconEngine, {
      config,
      forkChoice: {
        getHead: () => head,
        getFinalizedCheckpoint: () => checkpoints.finalized,
        getBlockDefaultStatus: () => head,
      },
      regen: {getStateSync: () => view, getCheckpointStateOrBytes},
      getHeadState: () => view,
    });
    getCheckpointStateOrBytes.mockReset();
  });

  it.each([false, true])("returns detached parent payload metadata with header state root set=%s", (hasStateRoot) => {
    view.cachedState.latestBlockHeader.slot = view.slot - 1;
    view.cachedState.latestBlockHeader.proposerIndex = 1;
    if (hasStateRoot) view.cachedState.latestBlockHeader.stateRoot = new Uint8Array(32).fill(7);
    view.cachedState.commit();
    const header = ssz.phase0.BeaconBlockHeader.clone(view.latestBlockHeader);
    if (!hasStateRoot) header.stateRoot = view.hashTreeRoot();
    const root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);

    const result = engine.getHeadParentPayload();
    expect(roundTripMessage(result)).toStrictEqual({
      blockRoot: root,
      blockRootHex: toRootHex(root),
      slot: view.slot - 1,
      proposerIndex: 1,
      forkName: ForkName.gloas,
      bid: view.latestExecutionPayloadBid,
    });
    if (!result) throw Error("Expected parent payload");
    result.bid.blockHash.fill(9);
    result.blockRoot.fill(9);
    expect(view.latestExecutionPayloadBid.blockHash).toEqual(new Uint8Array(32));
    expect(view.latestBlockHeader.stateRoot).toEqual(new Uint8Array(32).fill(hasStateRoot ? 7 : 0));
    expect(engine.getHeadParentPayload()?.blockRoot).toEqual(root);
  });

  it("does not request a dangling payload for the genesis header", () => {
    expect(view.latestBlockHeader.slot).toBe(0);
    expect(engine.getHeadParentPayload()).toBeUndefined();
  });

  it("sends finality checkpoints through a worker message as plain values", async () => {
    const result = await engine.getStateFinalityCheckpoints({head: true});

    expect(roundTripMessage(result)).toStrictEqual({
      data: checkpoints,
      executionOptimistic: true,
      finalized: false,
    });
  });

  it.each([
    {name: "all builders", ids: [], statuses: [], data: builderResponses},
    {name: "selected builders", ids: [1, 0], statuses: [], data: [builderResponses[1], builderResponses[0]]},
    {name: "all builders filtered by status", ids: [], statuses: ["active"], data: [builderResponses[0]]},
    {name: "selected builders filtered by status", ids: [0, 1], statuses: ["pending"], data: [builderResponses[1]]},
  ])("sends $name through a worker message as plain values", async ({ids, statuses, data}) => {
    const result = await engine.getStateBuilders({head: true}, ids, statuses);

    expect(roundTripMessage(result)).toStrictEqual({data, executionOptimistic: true, finalized: false});
  });

  it.each(["view", "bytes"])("serves balances and finality from checkpoint %s", async (format) => {
    getCheckpointStateOrBytes.mockResolvedValue(format === "bytes" ? view.serialize() : view);

    expect(roundTripMessage(await engine.getFinalizedEffectiveBalances(checkpoint, [1, 0, 1]))).toStrictEqual([
      31_000_000_000, 32_000_000_000, 31_000_000_000,
    ]);
    expect(roundTripMessage(await engine.getStateFinalityCheckpoints(checkpoint))).toStrictEqual({
      data: checkpoints,
      executionOptimistic: true,
      finalized: true,
    });
    expect(getCheckpointStateOrBytes).toHaveBeenCalledWith({epoch: checkpoint.epoch, rootHex: checkpoint.rootHex});
  });

  it("returns null when the checkpoint state is unavailable", async () => {
    getCheckpointStateOrBytes.mockResolvedValue(null);

    expect(await engine.getFinalizedEffectiveBalances(checkpoint, [0])).toBeNull();
    expect(await engine.getStateFinalityCheckpoints(checkpoint)).toBeNull();
  });
});

function roundTripMessage(value: unknown): unknown {
  const {port1, port2} = new MessageChannel();
  try {
    port1.postMessage(value);
    return receiveMessageOnPort(port2)?.message;
  } finally {
    port1.close();
    port2.close();
  }
}
