import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus, ProtoArray, ProtoNode} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Root, RootHex} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {FinalizedCheckpointSnapshot} from "../../../../src/chain/beaconEngine/interface.js";
import {ChainView} from "../../../../src/chain/chainView/chainView.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

async function setup() {
  const root = Buffer.alloc(32, 1);
  const anchor = generateProtoBlock({blockRoot: toRootHex(root)}) as ProtoNode;
  const checkpoint: CheckpointWithHex = {epoch: 0, root, rootHex: anchor.blockRoot};
  const forkChoice = {
    getAllNodes: vi.fn(() => [anchor]),
    getHead: vi.fn(() => anchor),
    getJustifiedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedBlock: vi.fn(() => anchor),
    getAllAncestorAndNonAncestorBlocksDefaultStatus: vi
      .fn<(root: RootHex) => {ancestors: ProtoNode[]; nonAncestors: ProtoNode[]}>()
      .mockReturnValue({ancestors: [anchor], nonAncestors: []}),
  };
  const events = new BeaconEngineEventBus();
  const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
    forkChoice,
    emitter: events,
    close: vi.fn().mockResolvedValue(undefined),
  });
  const view = new ChainView(await core.getChainViewSnapshot());
  const emitter = new ChainEventEmitter();
  emitter.on(ChainEvent.chainViewUpdated, (update) => view.applyUpdate(update));
  const logger = getMockedLogger();
  const engine = new BeaconEngine({
    core,
    config: createBeaconConfig({}, Buffer.alloc(32)),
    emitter,
    clock: new ClockStopped(0),
    serializedCache: new SerializedCache(),
    logger,
  });
  const onFinalized = vi.fn();
  emitter.on(ChainEvent.forkChoiceFinalized, (cp) => {
    expect(view.getFinalizedCheckpoint().rootHex).toBe(cp.rootHex);
    expect(view.getFinalizedCheckpoint().epoch).toBe(cp.epoch);
    expect(view.getFinalizedBlock().slot).toBe(cp.slot);
    onFinalized(cp);
  });
  const finalize = (epoch: number) => {
    const root = Buffer.alloc(32, epoch + 1);
    const block: ProtoNode = {
      ...anchor,
      blockRoot: toRootHex(root),
      parentRoot: forkChoice.getHead().blockRoot,
      slot: epoch * SLOTS_PER_EPOCH - 1,
      stateRoot: toRootHex(Buffer.alloc(32, epoch + 11)),
      executionPayloadBlockHash: toRootHex(root),
      executionPayloadNumber: epoch,
      executionPayloadGasLimit: 30_000_000,
      executionStatus: ExecutionStatus.Syncing,
    };
    forkChoice.getAllNodes.mockReturnValue([...forkChoice.getAllNodes(), block]);
    forkChoice.getHead.mockReturnValue(block);
    forkChoice.getFinalizedBlock.mockReturnValue(block);
    forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch, root, rootHex: block.blockRoot});
    forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({
      ancestors: [...forkChoice.getAllNodes()].reverse(),
      nonAncestors: [],
    });
    return block;
  };
  return {core, engine, events, emitter, forkChoice, view, onFinalized, logger, finalize};
}

describe("finalized checkpoint pull", () => {
  it("returns detached bytes and the finalized block's optimism, independent of head", async () => {
    const {core, forkChoice, finalize} = await setup();
    const block = finalize(1);
    forkChoice.getHead.mockReturnValue({...block, executionStatus: ExecutionStatus.Valid});
    const ancestors = [...forkChoice.getAllNodes()].reverse();
    const orphan = {...block, blockRoot: toRootHex(Buffer.alloc(32, 99))};
    forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({ancestors, nonAncestors: [orphan]});
    const summarize = ({slot, blockRoot, payloadStatus}: ProtoNode) => ({
      slot,
      blockRoot: fromHex(blockRoot),
      payloadStatus,
    });
    const blockSnapshot = {canonical: ancestors.map(summarize), nonCanonical: [summarize(orphan)]};
    const result = core.getFinalizedCheckpointSnapshot();
    expect(result).toEqual({
      epoch: 1,
      root: fromHex(block.blockRoot),
      slot: SLOTS_PER_EPOCH - 1,
      stateRoot: fromHex(block.stateRoot),
      executionOptimistic: true,
      blockSnapshot,
    });
    expect(forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus).toHaveBeenCalledExactlyOnceWith(block.blockRoot);
    result.root.fill(0);
    result.stateRoot.fill(0);
    for (const summary of [...result.blockSnapshot.canonical, ...result.blockSnapshot.nonCanonical]) {
      summary.blockRoot.fill(0);
      summary.slot = -1;
    }
    block.executionStatus = ExecutionStatus.Valid;
    const next = core.getFinalizedCheckpointSnapshot();
    expect(next.root).toEqual(fromHex(block.blockRoot));
    expect(next.stateRoot).toEqual(fromHex(block.stateRoot));
    expect(next.executionOptimistic).toBe(false);
    expect(next.blockSnapshot).toEqual(blockSnapshot);
    expect(result.executionOptimistic).toBe(true);
  });

  it("updates ChainView before the data-free signal and publishes the pulled checkpoint", async () => {
    const {core, events, view, forkChoice, onFinalized, finalize} = await setup();
    const pull = vi.spyOn(core, "getFinalizedCheckpointSnapshot");
    const onSignal = vi.fn(() => {
      expect(view.getFinalizedCheckpoint().epoch).toBe(1);
      expect(view.getFinalizedBlock().slot).toBe(SLOTS_PER_EPOCH - 1);
    });
    events.on(BeaconEngineEvent.newFinalizedCheckpoint, onSignal);
    core.publishChainView();
    expect(onSignal).not.toHaveBeenCalled();
    const block = finalize(1);
    const orphan = {...block, blockRoot: toRootHex(Buffer.alloc(32, 99))};
    forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({
      ancestors: [...forkChoice.getAllNodes()].reverse(),
      nonAncestors: [orphan],
    });
    core.publishChainView();
    expect(onSignal).toHaveBeenCalledExactlyOnceWith();
    expect(onFinalized).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(pull).toHaveBeenCalledExactlyOnceWith();
    const summarize = ({slot, blockRoot, payloadStatus}: ProtoNode) => ({slot, blockRoot, payloadStatus});
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith({
      epoch: 1,
      root: fromHex(block.blockRoot),
      rootHex: block.blockRoot,
      slot: block.slot,
      stateRoot: fromHex(block.stateRoot),
      executionOptimistic: true,
      blockSnapshot: {
        canonical: [...forkChoice.getAllNodes()].reverse().map(summarize),
        nonCanonical: [summarize(orphan)],
      },
    });
    core.publishChainView();
    block.executionStatus = ExecutionStatus.Valid;
    core.publishChainView();
    expect(onSignal).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledOnce();
  });

  it("signals checkpoint changes even when head and block metadata do not change", async () => {
    const {core, forkChoice, onFinalized} = await setup();
    forkChoice.getFinalizedCheckpoint.mockReturnValue({...forkChoice.getFinalizedCheckpoint(), epoch: 1});
    core.publishChainView(false);
    await Promise.resolve();
    expect(onFinalized).toHaveBeenCalledOnce();
    expect(onFinalized.mock.calls[0][0].epoch).toBe(1);
  });

  it("emits each pulled checkpoint as soon as its data is available", async () => {
    const {core, onFinalized, finalize, events} = await setup();
    finalize(1);
    const checkpoint = core.getFinalizedCheckpointSnapshot();
    const pending = defer<FinalizedCheckpointSnapshot<Root>>();
    const pull = vi.fn<() => FinalizedCheckpointSnapshot<Root> | Promise<FinalizedCheckpointSnapshot<Root>>>();
    pull.mockReturnValueOnce(pending.promise).mockReturnValue(checkpoint);
    Object.assign(core, {getFinalizedCheckpointSnapshot: pull});
    core.publishChainView();
    events.emit(BeaconEngineEvent.newFinalizedCheckpoint);
    await Promise.resolve();
    expect(pull).toHaveBeenCalledTimes(2);
    expect(onFinalized).toHaveBeenCalledOnce();
    const expected = onFinalized.mock.calls[0][0];
    expect(expected).toMatchObject({epoch: checkpoint.epoch, rootHex: toRootHex(checkpoint.root)});
    pending.resolve(checkpoint);
    await pending.promise;
    expect(onFinalized.mock.calls).toEqual([[expected], [expected]]);
  });

  it("logs a failed pull and can process the next signal", async () => {
    const {core, events, onFinalized, logger, finalize} = await setup();
    finalize(1);
    const failure = Error("pull failed");
    vi.spyOn(core, "getFinalizedCheckpointSnapshot").mockImplementationOnce(() => {
      throw failure;
    });
    core.publishChainView();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("Error pulling finalized checkpoint", {}, failure);
    expect(onFinalized).not.toHaveBeenCalled();
    events.emit(BeaconEngineEvent.newFinalizedCheckpoint);
    await Promise.resolve();
    expect(onFinalized).toHaveBeenCalledOnce();
  });

  it("discards a pending pull after close and detaches the notification listener", async () => {
    const {core, engine, events, onFinalized, finalize} = await setup();
    finalize(1);
    const checkpoint = core.getFinalizedCheckpointSnapshot();
    const pending = defer<FinalizedCheckpointSnapshot<Root>>();
    const pull = vi.fn(() => pending.promise);
    Object.assign(core, {getFinalizedCheckpointSnapshot: pull});
    core.publishChainView();
    await engine.close();
    pending.resolve(checkpoint);
    await pending.promise;
    events.emit(BeaconEngineEvent.newFinalizedCheckpoint);
    expect(pull).toHaveBeenCalledOnce();
    expect(onFinalized).not.toHaveBeenCalled();
    expect(events.listenerCount(BeaconEngineEvent.newFinalizedCheckpoint)).toBe(0);
  });

  it("uses fork-choice archival traversal across Gloas variants and pruning", async () => {
    const {core, forkChoice} = await setup();
    const root = (n: number) => toRootHex(Buffer.alloc(32, n));
    const anchor = generateProtoBlock({
      blockRoot: root(1),
      slot: 0,
      executionPayloadBlockHash: root(11),
      executionStatus: ExecutionStatus.Valid,
      executionPayloadNumber: 0,
      executionPayloadGasLimit: 30_000_000,
    });
    const protoArray = ProtoArray.initialize(anchor, 0);
    const add = (n: number, slot: number, parent: number, hash: number) =>
      protoArray.onBlock(
        {
          ...anchor,
          blockRoot: root(n),
          slot,
          parentRoot: root(parent),
          parentBlockHash: root(hash),
          executionPayloadBlockHash: root(hash),
          executionStatus: ExecutionStatus.Valid,
          executionPayloadNumber: slot,
          executionPayloadGasLimit: 30_000_000,
        },
        slot,
        null
      );
    add(2, 1, 1, 11);
    protoArray.onExecutionPayload(
      root(2),
      1,
      root(12),
      1,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      anchor.dataAvailabilityStatus
    );
    add(3, 2, 1, 11);
    add(4, 3, 2, 12);
    forkChoice.getAllNodes.mockImplementation(() => protoArray.nodes);
    forkChoice.getHead.mockImplementation(() => {
      const head = protoArray.nodes.at(-1);
      if (!head) throw Error("Expected proto-array head");
      return head;
    });
    forkChoice.getFinalizedCheckpoint.mockReturnValue({epoch: 2, root: fromHex(root(4)), rootHex: root(4)});
    forkChoice.getFinalizedBlock.mockReturnValue(forkChoice.getHead());
    forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockImplementation((blockRoot) => {
      const status = protoArray.getDefaultVariant(blockRoot);
      if (status === undefined) throw Error("Expected finalized variant");
      return protoArray.getAllAncestorAndNonAncestorNodes(blockRoot, status);
    });
    const summarize = ({slot, blockRoot, payloadStatus}: ProtoNode) => ({
      slot,
      blockRoot: fromHex(blockRoot),
      payloadStatus,
    });
    const expected = protoArray.getAllAncestorAndNonAncestorNodes(root(4), PayloadStatus.PENDING);
    expect(core.getFinalizedCheckpointSnapshot().blockSnapshot).toEqual({
      canonical: expected.ancestors.map(summarize),
      nonCanonical: expected.nonAncestors.map(summarize),
    });
    forkChoice.getHead.mockReturnValue(forkChoice.getHead());
    protoArray.onExecutionPayload(
      root(3),
      2,
      root(13),
      2,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      anchor.dataAvailabilityStatus
    );
    expect(
      core.getFinalizedCheckpointSnapshot().blockSnapshot,
      "exclude payload variants imported after the finalized node"
    ).toEqual({
      canonical: expected.ancestors.map(summarize),
      nonCanonical: expected.nonAncestors.map(summarize),
    });
    const captured = core.getFinalizedCheckpointSnapshot();
    protoArray.pruneThreshold = protoArray.nodes.length;
    expect(protoArray.maybePrune(root(2))).toEqual([]);
    expect(core.getFinalizedCheckpointSnapshot()).toEqual(captured);
    protoArray.pruneThreshold = 0;
    protoArray.maybePrune(root(2));
    const snapshot = core.getFinalizedCheckpointSnapshot().blockSnapshot;
    expect(snapshot.canonical.map((block) => [toRootHex(block.blockRoot), block.payloadStatus])).toEqual([
      [root(4), PayloadStatus.PENDING],
      [root(2), PayloadStatus.FULL],
    ]);
    expect(captured.blockSnapshot).toEqual({
      canonical: expected.ancestors.map(summarize),
      nonCanonical: expected.nonAncestors.map(summarize),
    });
  });
});
