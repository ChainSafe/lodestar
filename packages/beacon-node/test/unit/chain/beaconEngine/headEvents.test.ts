import {beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {EpochDifference, ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
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
  let order: string[];
  const onHead = vi.fn();
  const onHeadV2 = vi.fn();
  const onHeadUpdated = vi.fn();
  const close = vi.fn<() => Promise<void>>();
  const getDependentRoot = vi.fn<(head: ProtoBlock, difference: EpochDifference) => string>();

  beforeEach(() => {
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
    order = [];
    emitter = new ChainEventEmitter();
    events = new BeaconEngineEventBus();
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      config,
      emitter: events,
      logger: getMockedLogger(),
      close,
      forkChoice: {
        getHead: () => head,
        getDependentRoot,
        updateAndGetHead: () => {
          head = next;
          return {head};
        },
        updateTime: () => {
          head = next;
        },
      },
      publishChainView: () => {
        const checkpoint = {epoch: 0, root: Buffer.alloc(32), rootHex: root(0)};
        events.emit(BeaconEngineEvent.chainViewUpdated, {
          revision: 1,
          head,
          justified: checkpoint,
          finalized: checkpoint,
          blocks: [head],
        });
      },
    });
    engine = new BeaconEngine({
      core,
      config,
      emitter,
      clock: new ClockStopped(0),
      serializedCache: new SerializedCache(),
    });
    emitter.on(ChainEvent.chainViewUpdated, () => order.push("view"));
    events.on(BeaconEngineEvent.headUpdated, onHeadUpdated);
    emitter.on(routes.events.EventType.head, (event) => {
      order.push("head");
      onHead(event);
    });
    emitter.on(routes.events.EventType.headV2, (event) => {
      order.push("head_v2");
      onHeadV2(event);
    });
  });

  it.each(["recompute", "clock"])("publishes head events after ChainView on %s updates", async (trigger) => {
    if (trigger === "recompute") await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    else core.updateTime(next.slot);

    expect(order).toEqual(["view", "head", "head_v2"]);
    expect(onHeadUpdated).toHaveBeenCalledOnce();
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
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

    expect(order).toEqual(["view", "head_v2"]);
    expect(onHead).not.toHaveBeenCalled();
    expect(onHeadV2).toHaveBeenCalledOnce();
    expect(onHeadV2.mock.calls[0][0].data).toMatchObject({payloadStatus: expected, epochTransition: false});
  });

  it("does not notify head consumers when the root and payload status are unchanged", async () => {
    next = {...previous};
    await engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);

    expect(order).toEqual(["view"]);
    expect(onHeadUpdated).not.toHaveBeenCalled();
    expect(getDependentRoot).not.toHaveBeenCalled();
  });

  it("keeps the ChainView update when dependent-root lookup fails", async () => {
    getDependentRoot.mockImplementation(() => {
      throw Error("No block for root");
    });
    await expect(engine.recomputeForkChoiceHead(ForkchoiceCaller.importBlock)).resolves.toBe(next);
    expect(order).toEqual(["view"]);
    expect(onHeadUpdated).not.toHaveBeenCalled();
    expect(core.logger.debug).toHaveBeenCalled();
  });

  it.each([false, true])("detaches public head events on close, including failed close=%s", async (failClose) => {
    if (failClose) close.mockRejectedValueOnce(Error("close failed"));
    if (failClose) await expect(engine.close()).rejects.toThrow("close failed");
    else await engine.close();
    expect(close).toHaveBeenCalledOnce();

    core.recomputeForkChoiceHead(ForkchoiceCaller.importBlock);
    expect(onHeadUpdated).toHaveBeenCalledOnce();
    expect(onHead).not.toHaveBeenCalled();
    expect(onHeadV2).not.toHaveBeenCalled();
  });
});
