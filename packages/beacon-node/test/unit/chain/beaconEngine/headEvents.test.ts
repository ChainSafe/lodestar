import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {EpochDifference, ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/utils.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {ForkchoiceCaller} from "../../../../src/chain/forkChoice/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("BeaconEngine head notifications", () => {
  const root = (n: number) => toRootHex(Buffer.alloc(32, n));
  const config = createBeaconConfig(
    {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    },
    Buffer.alloc(32)
  );
  const previousDutyDependentRoot = root(3);
  const currentDutyDependentRoot = root(4);
  let previous: ProtoBlock;
  let next: ProtoBlock;
  let core: BeaconEngineCore;
  let engine: BeaconEngine;
  let emitter: ChainEventEmitter;
  let events: BeaconEngineEventBus;
  let view: ReplicateChainView;
  let order: string[];
  const onHead = vi.fn();
  const onHeadV2 = vi.fn();
  const close = vi.fn<() => Promise<void>>();
  const getDependentRoot = vi.fn<(head: ProtoBlock, difference: EpochDifference) => string>();

  beforeEach(async () => {
    vi.resetAllMocks();
    close.mockResolvedValue(undefined);
    getDependentRoot.mockImplementation((_, difference) =>
      difference === EpochDifference.previous ? previousDutyDependentRoot : currentDutyDependentRoot
    );
    previous = generateProtoBlock({blockRoot: root(1), slot: SLOTS_PER_EPOCH - 1});
    next = generateProtoBlock({
      blockRoot: root(2),
      stateRoot: root(5),
      slot: SLOTS_PER_EPOCH,
      payloadStatus: PayloadStatus.FULL,
      executionStatus: ExecutionStatus.Syncing,
    });
    let head = previous;
    const checkpoint = {epoch: 0, root: new Uint8Array(32), rootHex: root(0)};
    order = [];
    emitter = new ChainEventEmitter();
    events = new BeaconEngineEventBus();
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      emitter: events,
      logger: getMockedLogger(),
      close,
      attestationPool: {prune: vi.fn()},
      aggregatedAttestationPool: {prune: vi.fn()},
      syncCommitteeMessagePool: {prune: vi.fn()},
      seenSyncCommitteeMessages: {prune: vi.fn()},
      payloadAttestationPool: {prune: vi.fn()},
      executionPayloadBidPool: {prune: vi.fn()},
      seenExecutionPayloadBids: {prune: vi.fn()},
      proposerPreferencesPool: {prune: vi.fn()},
      seenAttestationDatas: {onSlot: vi.fn()},
      forkChoice: {
        getHead: () => head,
        getAllNodes: () => [previous, next],
        getJustifiedCheckpoint: () => checkpoint,
        getFinalizedCheckpoint: () => checkpoint,
        getDependentRoot,
        updateAndGetHead: () => {
          head = next;
          return {head};
        },
        updateTime: () => {
          head = next;
        },
      },
    });
    engine = new BeaconEngine({
      core,
      config,
      emitter,
      clock: new ClockStopped(0),
      serializedCache: new SerializedCache(),
      logger: core.logger,
      coreEmitter: core.emitter,
    });
    view = new ReplicateChainView(await core.getChainViewSnapshot());
    engine.chainView = view;
    const onChainViewUpdate = view.onChainViewUpdate.bind(view);
    vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
      const update = onChainViewUpdate(changes);
      order.push("view");
      return update;
    });
    emitter.on(routes.events.EventType.head, (event) => {
      expect(view.getHead()).toEqual(toChainViewBlock(next));
      order.push("head");
      onHead(event);
    });
    emitter.on(routes.events.EventType.headV2, (event) => {
      expect(view.getHead()).toEqual(toChainViewBlock(next));
      order.push("head_v2");
      onHeadV2(event);
    });
  });

  it.each(["recompute", "clock"])("publishes head events after ChainView on %s updates", async (trigger) => {
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    const coreEmit = vi.spyOn(events, "emit");
    if (trigger === "recompute") await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    else await engine.onSlot(next.slot);

    expect(order).toEqual(["view", "head", "head_v2"]);
    expect(coreEmit).not.toHaveBeenCalled();
    expect(headPull).toHaveBeenCalledExactlyOnceWith({
      blockRoot: fromHex(previous.blockRoot),
      payloadStatus: previous.payloadStatus,
    });
    expect(onHead).toHaveBeenCalledExactlyOnceWith({
      slot: next.slot,
      block: next.blockRoot,
      state: next.stateRoot,
      epochTransition: true,
      previousDutyDependentRoot,
      currentDutyDependentRoot,
      executionOptimistic: true,
    });
    expect(onHeadV2).toHaveBeenCalledExactlyOnceWith({
      version: ForkName.gloas,
      data: {
        slot: next.slot,
        block: next.blockRoot,
        state: next.stateRoot,
        payloadStatus: "full",
        epochTransition: true,
        currentEpochDependentRoot: previousDutyDependentRoot,
        nextEpochDependentRoot: currentDutyDependentRoot,
        executionOptimistic: true,
      },
    });
  });

  it.each([
    [PayloadStatus.PENDING, PayloadStatus.FULL, "full"],
    [PayloadStatus.FULL, PayloadStatus.EMPTY, "empty"],
    [PayloadStatus.EMPTY, PayloadStatus.PENDING, "empty"],
  ] as const)("publishes only head_v2 when payload status changes from %s to %s", async (before, after, expected) => {
    previous.payloadStatus = before;
    next = {...previous, payloadStatus: after};
    const head = toChainViewBlock(previous);
    view.onChainViewUpdate({
      blocks: [head],
      state: {head, justified: view.getJustifiedCheckpoint(), finalized: view.getFinalizedCheckpoint()},
    });
    order.length = 0;
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

    expect(order).toEqual(["view", "head_v2"]);
    expect(onHead).not.toHaveBeenCalled();
    expect(onHeadV2).toHaveBeenCalledOnce();
    expect(onHeadV2.mock.calls[0][0].data).toMatchObject({payloadStatus: expected, epochTransition: false});
  });

  it("does not pull or notify when the head and justified checkpoint are unchanged", async () => {
    next = {...previous};
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

    expect(order).toEqual([]);
    expect(headPull).not.toHaveBeenCalled();
    expect(getDependentRoot).not.toHaveBeenCalled();
  });

  it("does not report justified changes, which head recomputation cannot cause", async () => {
    next = {...previous};
    const checkpoint = core.forkChoice.getJustifiedCheckpoint();
    vi.spyOn(core.forkChoice, "getJustifiedCheckpoint").mockReturnValue({...checkpoint, epoch: 1});
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

    expect(order).toEqual([]);
    expect(headPull).not.toHaveBeenCalled();
  });

  it("returns a change flag without publishing from Core", async () => {
    const coreEmit = vi.spyOn(events, "emit");
    expect(await core.recomputeForkChoiceHead(ForkchoiceCaller.importBlock)).toEqual({headUpdate: true});
    expect(coreEmit).not.toHaveBeenCalled();
    expect(view.getHead()).toEqual(toChainViewBlock(previous));
  });

  it("propagates recomputation failures without pulling a head snapshot", async () => {
    const error = new Error("head computation failed");
    vi.spyOn(core.forkChoice, "updateAndGetHead").mockImplementation(() => {
      throw error;
    });
    const headPull = vi.spyOn(core, "getHeadSnapshot");
    await expect(engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock)).rejects.toBe(error);
    expect(headPull).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it("keeps the ChainView update when dependent-root lookup fails", async () => {
    getDependentRoot.mockImplementation(() => {
      throw Error("No block for root");
    });
    await expect(engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock)).resolves.toBeUndefined();
    expect(order).toEqual(["view"]);
    expect(view.getHead()).toEqual(toChainViewBlock(next));
    expect(core.logger.debug).toHaveBeenCalled();
  });

  it("keeps head computation successful when a public head listener throws", async () => {
    const error = new Error("head listener failed");
    emitter.on(routes.events.EventType.head, () => {
      throw error;
    });
    await expect(engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock)).resolves.toBeUndefined();
    expect(core.logger.debug).toHaveBeenCalledWith(
      "Error emitting head update",
      {slot: next.slot, root: next.blockRoot, headRootChanged: true},
      error
    );
  });

  it.each([false, true])("pulls and notifies after close, including failed close=%s", async (failClose) => {
    if (failClose) close.mockRejectedValueOnce(Error("close failed"));
    if (failClose) await expect(engine.close()).rejects.toThrow("close failed");
    else await engine.close();
    expect(close).toHaveBeenCalledOnce();

    const headPull = vi.spyOn(core, "getHeadSnapshot");
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    next = {...next, blockRoot: root(7)};
    await engine.onSlot(next.slot);
    expect(headPull).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["view", "head", "head_v2", "view", "head", "head_v2"]);
    expect(onHead).toHaveBeenCalledTimes(2);
    expect(onHeadV2).toHaveBeenCalledTimes(2);
  });
});
