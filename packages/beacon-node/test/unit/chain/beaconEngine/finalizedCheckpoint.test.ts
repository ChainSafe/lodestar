import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, ProtoNode} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {FinalizedCheckpoint} from "../../../../src/chain/beaconEngine/interface.js";
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
    return block;
  };
  return {core, engine, events, emitter, forkChoice, view, onFinalized, logger, finalize};
}

describe("finalized checkpoint pull", () => {
  it("returns detached bytes and the finalized block's optimism, independent of head", async () => {
    const {core, forkChoice, finalize} = await setup();
    const block = finalize(1);
    forkChoice.getHead.mockReturnValue({...block, executionStatus: ExecutionStatus.Valid});
    const result = core.getFinalizedCheckpoint();
    expect(result).toEqual({
      epoch: 1,
      root: fromHex(block.blockRoot),
      slot: SLOTS_PER_EPOCH - 1,
      stateRoot: fromHex(block.stateRoot),
      executionOptimistic: true,
    });
    result.root.fill(0);
    result.stateRoot.fill(0);
    block.executionStatus = ExecutionStatus.Valid;
    const next = core.getFinalizedCheckpoint();
    expect(next.root).toEqual(fromHex(block.blockRoot));
    expect(next.stateRoot).toEqual(fromHex(block.stateRoot));
    expect(next.executionOptimistic).toBe(false);
    expect(result.executionOptimistic).toBe(true);
  });

  it("updates ChainView before the data-free signal and publishes the pulled checkpoint", async () => {
    const {core, events, view, onFinalized, finalize} = await setup();
    const onSignal = vi.fn(() => {
      expect(view.getFinalizedCheckpoint().epoch).toBe(1);
      expect(view.getFinalizedBlock().slot).toBe(SLOTS_PER_EPOCH - 1);
    });
    events.on(BeaconEngineEvent.newFinalizedCheckpoint, onSignal);
    core.publishChainView();
    expect(onSignal).not.toHaveBeenCalled();
    const block = finalize(1);
    core.publishChainView();
    expect(onSignal).toHaveBeenCalledExactlyOnceWith();
    expect(onFinalized).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith({
      ...core.getFinalizedCheckpoint(),
      rootHex: block.blockRoot,
    });
    core.publishChainView();
    block.executionStatus = ExecutionStatus.Valid;
    core.publishChainView();
    expect(onSignal).toHaveBeenCalledOnce();
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
    const checkpoint = core.getFinalizedCheckpoint();
    const pending = defer<FinalizedCheckpoint>();
    const pull = vi.fn<() => FinalizedCheckpoint | Promise<FinalizedCheckpoint>>();
    pull.mockReturnValueOnce(pending.promise).mockReturnValue(checkpoint);
    Object.assign(core, {getFinalizedCheckpoint: pull});
    core.publishChainView();
    events.emit(BeaconEngineEvent.newFinalizedCheckpoint);
    await Promise.resolve();
    expect(pull).toHaveBeenCalledTimes(2);
    const expected = {...checkpoint, rootHex: toRootHex(checkpoint.root)};
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith(expected);
    pending.resolve(checkpoint);
    await pending.promise;
    expect(onFinalized.mock.calls).toEqual([[expected], [expected]]);
  });

  it("logs a failed pull and can process the next signal", async () => {
    const {core, events, onFinalized, logger, finalize} = await setup();
    finalize(1);
    const failure = Error("pull failed");
    vi.spyOn(core, "getFinalizedCheckpoint").mockImplementationOnce(() => {
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
    const checkpoint = core.getFinalizedCheckpoint();
    const pending = defer<FinalizedCheckpoint>();
    const pull = vi.fn(() => pending.promise);
    Object.assign(core, {getFinalizedCheckpoint: pull});
    core.publishChainView();
    await engine.close();
    pending.resolve(checkpoint);
    await pending.promise;
    events.emit(BeaconEngineEvent.newFinalizedCheckpoint);
    expect(pull).toHaveBeenCalledOnce();
    expect(onFinalized).not.toHaveBeenCalled();
    expect(events.listenerCount(BeaconEngineEvent.newFinalizedCheckpoint)).toBe(0);
  });
});
