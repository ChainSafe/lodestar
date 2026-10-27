import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus, ProtoArray, ProtoNode} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {Root, RootHex, ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {toChainViewBlock, toChainViewBlockBytes} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {
  FinalizedCheckpointSnapshot,
  HeadSnapshot,
  ImportBlockResponse,
} from "../../../../src/chain/beaconEngine/interface.js";
import {BlockInputPreData, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {ForkChoiceChainView} from "../../../../src/chain/chainView/forkChoiceChainView.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
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
    updateTime: vi.fn<(slot: number) => void>(),
    getDependentRoot: vi.fn(() => anchor.blockRoot),
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
  const logger = getMockedLogger();
  const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
    forkChoice,
    forkChoiceVersion: 0,
    emitter: events,
    logger,
    close: vi.fn().mockResolvedValue(undefined),
    attestationPool: {prune: vi.fn()},
    aggregatedAttestationPool: {prune: vi.fn()},
    syncCommitteeMessagePool: {prune: vi.fn()},
    seenSyncCommitteeMessages: {prune: vi.fn()},
    payloadAttestationPool: {prune: vi.fn()},
    executionPayloadBidPool: {prune: vi.fn()},
    seenExecutionPayloadBids: {prune: vi.fn()},
    proposerPreferencesPool: {prune: vi.fn()},
    seenAttestationDatas: {onSlot: vi.fn()},
  });
  const emitter = new ChainEventEmitter();
  const engine = new BeaconEngine({
    core,
    config: createBeaconConfig({}, Buffer.alloc(32)),
    emitter,
    clock: new ClockStopped(0),
    serializedCache: new SerializedCache(),
    logger,
    beaconEngineWorker: true,
  });
  const view = new ReplicateChainView(await core.getChainViewSnapshot());
  engine.chainView = view;
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

describe("stale import response", () => {
  it("merges blocks and emits its justified change, but keeps newer head state and skips head events", async () => {
    const {core, engine, emitter, view} = await setup();
    const previousHead = view.getHead();
    const justified = view.getJustifiedCheckpoint();
    // A newer response was already applied
    view.onChainViewUpdate({
      blocks: [],
      state: {head: previousHead, justified, finalized: view.getFinalizedCheckpoint()},
      version: 5,
    });
    const imported = toChainViewBlockBytes(generateProtoBlock({blockRoot: toRootHex(Buffer.alloc(32, 9)), slot: 1}));
    vi.spyOn(core, "importBlock").mockResolvedValue({
      err: null,
      result: {
        block: imported,
        newHead: imported,
        justified: {epoch: justified.epoch, root: justified.root},
        finalized: {epoch: 0, root: fromHex(previousHead.blockRoot)},
        executionOptimistic: false,
        headUpdate: {
          slot: 1,
          blockRoot: imported.blockRoot,
          stateRoot: imported.stateRoot,
          payloadStatus: PayloadStatus.FULL,
          headRootChanged: true,
          epochTransition: false,
          previousDutyDependentRoot: imported.blockRoot,
          currentDutyDependentRoot: imported.blockRoot,
          executionOptimistic: false,
        },
        reorg: null,
        justifiedCheckpointChanged: true,
        finalizedCheckpointChanged: false,
        version: 4,
      },
    });
    const events: string[] = [];
    emitter.on(routes.events.EventType.head, () => events.push("head"));
    emitter.on(ChainEvent.updateStatus, () => events.push("status"));
    emitter.on(ChainEvent.forkChoiceJustified, () => events.push("justified"));
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = 1;
    const input = BlockInputPreData.createFromBlock({
      block: signedBlock,
      blockRootHex: toRootHex(imported.blockRoot),
      forkName: ForkName.phase0,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });

    await engine.importBlock(input, DataAvailabilityStatus.PreData, {});

    expect(view.getHead()).toEqual(previousHead);
    expect(view.version).toBe(5);
    expect(view.hasBlockHexUnsafe(toRootHex(imported.blockRoot))).toBe(true);
    expect(events).toEqual(["justified"]);
  });
});

describe("finalized checkpoint pull", () => {
  it("applies an import response before events and pulls finalization once across a later slot update", async () => {
    const {core, engine, emitter, forkChoice, view, onFinalized, finalize, logger} = await setup();
    const previousHead = view.getHead();
    const block = finalize(1);
    const summary = toChainViewBlockBytes(block);
    const response: ImportBlockResponse = {
      block: summary,
      newHead: summary,
      justified: {epoch: 0, root: fromHex(previousHead.blockRoot)},
      finalized: {epoch: 1, root: fromHex(block.blockRoot)},
      executionOptimistic: true,
      headUpdate: {
        slot: block.slot,
        blockRoot: summary.blockRoot,
        stateRoot: summary.stateRoot,
        payloadStatus: block.payloadStatus,
        headRootChanged: true,
        epochTransition: false,
        previousDutyDependentRoot: fromHex(previousHead.blockRoot),
        currentDutyDependentRoot: summary.blockRoot,
        executionOptimistic: true,
      },
      reorg: {
        slot: block.slot,
        epoch: 0,
        depth: 1,
        oldHeadBlock: fromHex(previousHead.blockRoot),
        newHeadBlock: summary.blockRoot,
        oldHeadState: fromHex(previousHead.stateRoot),
        newHeadState: summary.stateRoot,
        executionOptimistic: true,
      },
      justifiedCheckpointChanged: false,
      finalizedCheckpointChanged: true,
      version: 1,
    };
    const pending = defer<ImportBlockResponse>();
    const coreImport = vi.spyOn(core, "importBlock").mockImplementation(async () => ({
      err: null,
      result: structuredClone(await pending.promise),
    }));
    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    signedBlock.message.slot = block.slot;
    const input = BlockInputPreData.createFromBlock({
      block: signedBlock,
      blockRootHex: block.blockRoot,
      forkName: ForkName.phase0,
      daOutOfRange: false,
      source: BlockInputSource.gossip,
      seenTimestampSec: 0,
    });
    const pull = vi.spyOn(core, "getFinalizedCheckpointSnapshot");
    const observed: string[] = [];
    const onChainViewUpdate = view.onChainViewUpdate.bind(view);
    vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
      observed.push("view");
      return onChainViewUpdate(changes);
    });
    for (const event of [
      routes.events.EventType.head,
      routes.events.EventType.headV2,
      routes.events.EventType.chainReorg,
    ]) {
      emitter.on(event, () => {
        expect(view.getHead(), `head visible during ${event}`).toEqual(toChainViewBlock(block));
        expect(view.getFinalizedBlock().blockRoot, `finalized root visible during ${event}`).toBe(block.blockRoot);
        observed.push(event);
      });
    }
    const reorg = vi.fn();
    emitter.on(routes.events.EventType.chainReorg, reorg);
    const importing = engine.importBlock(input, DataAvailabilityStatus.PreData, {});
    expect(view.getHead()).toEqual(previousHead);
    expect(observed).toEqual([]);
    pending.resolve(response);
    expect(await importing).toEqual({
      block: toChainViewBlock(block),
      newHead: toChainViewBlock(block),
      executionOptimistic: true,
    });
    expect(observed).toEqual(["view", "head", "head_v2", "chain_reorg"]);
    expect(reorg).toHaveBeenCalledExactlyOnceWith({
      ...response.reorg,
      oldHeadBlock: previousHead.blockRoot,
      newHeadBlock: block.blockRoot,
      oldHeadState: previousHead.stateRoot,
      newHeadState: block.stateRoot,
    });
    expect(onFinalized).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledOnce();

    await engine.onSlot(SLOTS_PER_EPOCH + 1);
    expect(pull).toHaveBeenCalledOnce();
    expect(view.getHead()).toEqual(toChainViewBlock(forkChoice.getHead()));

    const error = new Error("head listener failed");
    emitter.once(routes.events.EventType.head, () => {
      throw error;
    });
    coreImport.mockResolvedValueOnce({
      err: null,
      result: {...response, finalizedCheckpointChanged: false, reorg: null},
    });
    await expect(engine.importBlock(input, DataAvailabilityStatus.PreData, {})).resolves.toMatchObject({
      executionOptimistic: true,
    });
    expect(logger.debug).toHaveBeenCalledWith(
      "Error emitting head update",
      {slot: block.slot, root: block.blockRoot, headRootChanged: true},
      error
    );

    const afterClose = defer<ImportBlockResponse>();
    coreImport.mockImplementationOnce(async () => ({err: null, result: await afterClose.promise}));
    const importingAtClose = engine.importBlock(input, DataAvailabilityStatus.PreData, {});
    await engine.close();
    const observedAtClose = [...observed];
    afterClose.resolve(response);
    await importingAtClose;
    expect(observed).toEqual([...observedAtClose, "view", "head", "head_v2", "chain_reorg"]);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(reorg).toHaveBeenCalledTimes(2);
    expect(onFinalized).toHaveBeenCalledTimes(2);
  });

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

  it("does not pull or publish on an unchanged slot", async () => {
    const {core, engine, events, emitter} = await setup();
    const onSlot = vi.spyOn(core, "onSlot");
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    const finalizedPull = vi.spyOn(core, "getFinalizedCheckpointSnapshot");
    const coreEmit = vi.spyOn(events, "emit");
    const emit = vi.spyOn(emitter, "emit");
    await engine.onSlot(1);
    expect(onSlot).toHaveReturnedWith({
      headUpdate: false,
      justifiedCheckpointChanged: false,
      finalizedCheckpointChanged: false,
    });
    expect(headPull).not.toHaveBeenCalled();
    expect(finalizedPull).not.toHaveBeenCalled();
    expect(coreEmit).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(core.attestationPool.prune).toHaveBeenCalledWith(1);
    expect(core.seenAttestationDatas.onSlot).toHaveBeenCalledWith(1);
  });

  it.each(["root", "payload", "justified", "head+justified"])("updates the view before %s events", async (change) => {
    const {core, engine, events, emitter, forkChoice, view} = await setup();
    const previous = forkChoice.getHead();
    const justifiedChanged = change === "justified" || change === "head+justified";
    forkChoice.updateTime.mockImplementationOnce(() => {
      if (change === "root" || change === "head+justified") {
        forkChoice.getHead.mockReturnValue({
          ...previous,
          blockRoot: toRootHex(Buffer.alloc(32, 2)),
          parentRoot: previous.blockRoot,
          slot: 1,
        });
      } else if (change === "payload") {
        forkChoice.getHead.mockReturnValue({...previous, payloadStatus: PayloadStatus.EMPTY});
      }
      if (justifiedChanged) {
        forkChoice.getJustifiedCheckpoint.mockReturnValue({...forkChoice.getJustifiedCheckpoint(), epoch: 1});
      }
    });
    const onSlot = vi.spyOn(core, "onSlot");
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    const finalizedPull = vi.spyOn(core, "getFinalizedCheckpointSnapshot");
    const coreEmit = vi.spyOn(events, "emit");
    const observed: string[] = [];
    const onChainViewUpdate = view.onChainViewUpdate.bind(view);
    vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
      observed.push("view");
      return onChainViewUpdate(changes);
    });
    emitter.on(ChainEvent.forkChoiceJustified, (checkpoint) => {
      expect(view.getHead()).toEqual(toChainViewBlock(forkChoice.getHead()));
      expect(view.getJustifiedCheckpoint()).toEqual(structuredClone(forkChoice.getJustifiedCheckpoint()));
      expect(checkpoint).toEqual(view.getJustifiedCheckpoint());
      observed.push("justified");
    });
    for (const event of [routes.events.EventType.head, routes.events.EventType.headV2]) {
      emitter.on(event, () => {
        expect(view.getHead(), `head visible during ${event}`).toEqual(toChainViewBlock(forkChoice.getHead()));
        observed.push(event);
      });
    }
    await engine.onSlot(SLOTS_PER_EPOCH);
    expect(onSlot).toHaveReturnedWith({
      headUpdate: change !== "justified",
      justifiedCheckpointChanged: justifiedChanged,
      finalizedCheckpointChanged: false,
    });
    // a justified-only change refreshes the replica without head events
    expect(headPull).toHaveBeenCalledExactlyOnceWith(
      change === "justified"
        ? undefined
        : {blockRoot: fromHex(previous.blockRoot), payloadStatus: previous.payloadStatus}
    );
    expect(finalizedPull).not.toHaveBeenCalled();
    expect(coreEmit).not.toHaveBeenCalled();
    expect(view.getJustifiedCheckpoint()).toEqual(structuredClone(forkChoice.getJustifiedCheckpoint()));
    const headEvents = change === "justified" ? [] : change === "payload" ? ["head_v2"] : ["head", "head_v2"];
    expect(observed).toEqual(["view", ...(justifiedChanged ? ["justified"] : []), ...headEvents]);
    const snapshot = headPull.mock.results[0].value;
    expect(structuredClone(snapshot)).toEqual(snapshot);
    snapshot.head.blockRoot.fill(0);
    snapshot.justified.root.fill(0);
    expect(forkChoice.getHead().blockRoot).not.toBe(toRootHex(snapshot.head.blockRoot));
    expect(toRootHex(forkChoice.getJustifiedCheckpoint().root)).toBe(previous.blockRoot);
  });

  it("notifies justified changes without pulling a snapshot when the view reads fork choice directly", async () => {
    const {core, engine, emitter, forkChoice} = await setup();
    engine.chainView = new ForkChoiceChainView(core);
    const checkpoint = {...forkChoice.getJustifiedCheckpoint(), epoch: 1};
    forkChoice.updateTime.mockImplementationOnce(() => {
      forkChoice.getJustifiedCheckpoint.mockReturnValue(checkpoint);
    });
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    const onJustified = vi.fn(() => {
      expect(engine.chainView.getJustifiedCheckpoint()).toEqual(checkpoint);
    });
    emitter.on(ChainEvent.forkChoiceJustified, onJustified);

    await engine.onSlot(SLOTS_PER_EPOCH);

    expect(headPull).not.toHaveBeenCalled();
    expect(onJustified).toHaveBeenCalledExactlyOnceWith(checkpoint);
  });

  it("updates ChainView before pulling finalization from a slot response", async () => {
    const {core, engine, events, view, forkChoice, onFinalized, finalize} = await setup();
    const pull = vi.spyOn(core, "getFinalizedCheckpointSnapshot").mockImplementation(() => {
      expect(view.getFinalizedCheckpoint().epoch).toBe(1);
      expect(view.getFinalizedBlock().slot).toBe(SLOTS_PER_EPOCH - 1);
      return BeaconEngineCore.prototype.getFinalizedCheckpointSnapshot.call(core);
    });
    const onSlot = vi.spyOn(core, "onSlot");
    const coreEmit = vi.spyOn(events, "emit");
    forkChoice.updateTime.mockImplementationOnce(() => {
      const block = finalize(1);
      const orphan = {...block, blockRoot: toRootHex(Buffer.alloc(32, 99))};
      forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({
        ancestors: [...forkChoice.getAllNodes()].reverse(),
        nonAncestors: [orphan],
      });
    });
    await engine.onSlot(SLOTS_PER_EPOCH);
    expect(onSlot).toHaveReturnedWith({
      headUpdate: true,
      justifiedCheckpointChanged: false,
      finalizedCheckpointChanged: true,
    });
    expect(coreEmit).not.toHaveBeenCalled();
    expect(pull).toHaveBeenCalledExactlyOnceWith();
    const block = forkChoice.getHead();
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
        nonCanonical: [summarize({...block, blockRoot: toRootHex(Buffer.alloc(32, 99))})],
      },
    });
    await engine.onSlot(SLOTS_PER_EPOCH + 1);
    block.executionStatus = ExecutionStatus.Valid;
    await engine.onSlot(SLOTS_PER_EPOCH + 2);
    expect(pull).toHaveBeenCalledOnce();
  });

  it("handles finalization when the head and block metadata do not change", async () => {
    const {core, engine, forkChoice, onFinalized, view} = await setup();
    const head = view.getHead();
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    const finalizedPull = vi.spyOn(core, "getFinalizedCheckpointSnapshot");
    forkChoice.updateTime.mockImplementationOnce(() => {
      forkChoice.getFinalizedCheckpoint.mockReturnValue({...forkChoice.getFinalizedCheckpoint(), epoch: 1});
    });
    const onSlot = vi.spyOn(core, "onSlot");
    await engine.onSlot(SLOTS_PER_EPOCH);
    expect(onSlot).toHaveReturnedWith({
      headUpdate: false,
      justifiedCheckpointChanged: false,
      finalizedCheckpointChanged: true,
    });
    expect(headPull).not.toHaveBeenCalled();
    expect(finalizedPull).toHaveBeenCalledExactlyOnceWith();
    expect(view.getHead()).toEqual(head);
    expect(view.getFinalizedCheckpoint().epoch).toBe(1);
    expect(onFinalized).toHaveBeenCalledOnce();
    expect(onFinalized.mock.calls[0][0].epoch).toBe(1);
  });

  it("keeps the slot view update when dependent-root lookup fails", async () => {
    const {core, engine, forkChoice, view, logger, emitter} = await setup();
    forkChoice.updateTime.mockImplementationOnce(() => {
      forkChoice.getHead.mockReturnValue({...forkChoice.getHead(), payloadStatus: PayloadStatus.EMPTY});
    });
    forkChoice.getDependentRoot.mockImplementation(() => {
      throw Error("No block for root");
    });
    const onHead = vi.fn();
    emitter.on(routes.events.EventType.headV2, onHead);
    await engine.onSlot(1);
    expect(view.getHead().payloadStatus).toBe(PayloadStatus.EMPTY);
    expect(onHead).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    expect(core.attestationPool.prune).toHaveBeenCalledWith(1);
  });

  it("emits each pulled checkpoint as soon as its data is available", async () => {
    const {core, engine, onFinalized, finalize} = await setup();
    finalize(1);
    vi.spyOn(core, "onSlot").mockReturnValue({
      headUpdate: true,
      justifiedCheckpointChanged: false,
      finalizedCheckpointChanged: true,
    });
    const checkpoint = core.getFinalizedCheckpointSnapshot();
    const pending = defer<FinalizedCheckpointSnapshot<Root>>();
    const pull = vi.fn<() => FinalizedCheckpointSnapshot<Root> | Promise<FinalizedCheckpointSnapshot<Root>>>();
    pull.mockReturnValueOnce(pending.promise).mockReturnValue(checkpoint);
    Object.assign(core, {getFinalizedCheckpointSnapshot: pull});
    await engine.onSlot(SLOTS_PER_EPOCH);
    await engine.onSlot(SLOTS_PER_EPOCH + 1);
    expect(pull).toHaveBeenCalledTimes(2);
    expect(onFinalized).toHaveBeenCalledOnce();
    const expected = onFinalized.mock.calls[0][0];
    expect(expected).toMatchObject({epoch: checkpoint.epoch, rootHex: toRootHex(checkpoint.root)});
    pending.resolve(checkpoint);
    await pending.promise;
    expect(onFinalized.mock.calls).toEqual([[expected], [expected]]);
  });

  it("logs a failed pull and can process the next finalized checkpoint", async () => {
    const {core, engine, forkChoice, onFinalized, logger, finalize} = await setup();
    forkChoice.updateTime.mockImplementationOnce(() => {
      finalize(1);
    });
    const failure = Error("pull failed");
    vi.spyOn(core, "getFinalizedCheckpointSnapshot").mockImplementationOnce(() => {
      throw failure;
    });
    await engine.onSlot(SLOTS_PER_EPOCH);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("Error pulling finalized checkpoint", {}, failure);
    expect(onFinalized).not.toHaveBeenCalled();
    forkChoice.updateTime.mockImplementationOnce(() => {
      finalize(2);
    });
    await engine.onSlot(2 * SLOTS_PER_EPOCH);
    expect(onFinalized).toHaveBeenCalledOnce();
  });

  it("applies a pending finalization pull and emits its update after close", async () => {
    const {core, engine, forkChoice, onFinalized, finalize} = await setup();
    forkChoice.updateTime.mockImplementationOnce(() => {
      finalize(1);
    });
    const pending = defer<FinalizedCheckpointSnapshot<Root>>();
    const pull = vi.fn(() => pending.promise);
    Object.assign(core, {getFinalizedCheckpointSnapshot: pull});
    await engine.onSlot(SLOTS_PER_EPOCH);
    await engine.close();
    pending.resolve(BeaconEngineCore.prototype.getFinalizedCheckpointSnapshot.call(core));
    await pending.promise;
    await engine.onSlot(SLOTS_PER_EPOCH + 1);
    expect(pull).toHaveBeenCalledOnce();
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({epoch: 1, rootHex: forkChoice.getFinalizedCheckpoint().rootHex})
    );
  });

  it("applies a pending head pull and emits its update after close", async () => {
    const {core, engine, forkChoice, view, emitter} = await setup();
    const previous = view.getHead();
    forkChoice.updateTime.mockImplementationOnce(() => {
      forkChoice.getHead.mockReturnValue({...forkChoice.getHead(), payloadStatus: PayloadStatus.EMPTY});
    });
    const pending = defer<HeadSnapshot>();
    const pull = vi.fn(() => pending.promise);
    Object.assign(core, {getHeadSnapshot: pull});
    const emit = vi.spyOn(emitter, "emit");
    const processing = engine.onSlot(1);
    await Promise.resolve();
    expect(pull).toHaveBeenCalledOnce();
    await engine.close();
    pending.resolve(
      BeaconEngineCore.prototype.getHeadSnapshot.call(core, {
        blockRoot: fromHex(previous.blockRoot),
        payloadStatus: previous.payloadStatus,
      })
    );
    await processing;
    expect(view.getHead()).toEqual({...previous, payloadStatus: PayloadStatus.EMPTY});
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      routes.events.EventType.headV2,
      expect.objectContaining({data: expect.objectContaining({block: previous.blockRoot, payloadStatus: "empty"})})
    );
  });

  it.each([true, false])("prunes ChainView only after core completes finalization (success=%s)", async (success) => {
    const {core, engine, view} = await setup();
    const checkpoint = view.getFinalizedCheckpoint();
    const completion = defer<number>();
    vi.spyOn(core, "completeFinalization").mockReturnValue(completion.promise);
    const prune = vi.spyOn(view, "prune").mockImplementation(() => {});
    const completing = engine.completeFinalization(checkpoint);
    expect(prune).not.toHaveBeenCalled();
    if (success) {
      completion.resolve(3);
      expect(await completing).toBe(3);
      expect(prune).toHaveBeenCalledExactlyOnceWith(checkpoint);
    } else {
      completion.reject(new Error("archive failed"));
      await expect(completing).rejects.toThrow("archive failed");
      expect(prune).not.toHaveBeenCalled();
    }
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
