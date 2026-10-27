import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {PayloadStatus, ProtoBlock, UpdateHeadOpt} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {ErrorAborted, defer, fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {PREPARE_NEXT_SLOT_BPS, PrepareNextSlotScheduler} from "../../../../src/chain/prepareNextSlot.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateCachedBellatrixState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const clockSlot = SLOTS_PER_EPOCH - 1;
const opts = {produceSSEPayloadAttributes: false};

async function setup() {
  const config = createBeaconConfig({}, Buffer.alloc(32));
  const clock = new ClockStopped(clockSlot);
  const previous = generateProtoBlock({blockRoot: toRootHex(Buffer.alloc(32, 1)), slot: clockSlot - 1});
  const next = {
    ...previous,
    blockRoot: toRootHex(Buffer.alloc(32, 2)),
    parentRoot: previous.blockRoot,
    slot: clockSlot,
  };
  const checkpoint = {epoch: 0, root: fromHex(previous.blockRoot), rootHex: previous.blockRoot};
  const forkChoice = {
    getHead: vi.fn(() => previous),
    getAllNodes: vi.fn(() => [previous, next]),
    getJustifiedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedBlock: vi.fn(() => previous),
    getConfirmedBlock: vi.fn(() => previous),
    getConfirmedRoot: vi.fn(() => previous.blockRoot),
    getDependentRoot: vi.fn(() => previous.blockRoot),
    updateAndGetHead: vi.fn<(opts: {mode: UpdateHeadOpt}) => {head: ProtoBlock}>(),
  };
  forkChoice.updateAndGetHead.mockImplementation(() => {
    forkChoice.getHead.mockReturnValue(next);
    return {head: next};
  });
  const preparedState = {hashTreeRoot: vi.fn(() => new Uint8Array(32))};
  const regen = {
    getBlockSlotState: vi
      .fn<
        (
          ...args: Parameters<BeaconEngineCore["regen"]["getBlockSlotState"]>
        ) => Promise<Pick<BeaconStateView, "hashTreeRoot">>
      >()
      .mockResolvedValue(preparedState),
    updatePreComputedCheckpoint: vi.fn(() => 0),
  };
  const events = new BeaconEngineEventBus();
  const logger = getMockedLogger();
  const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
    config,
    clock,
    emitter: events,
    logger,
    forkChoice,
    regen,
    opts: {},
    beaconProposerCache: {has: vi.fn(() => false)},
    close: vi.fn().mockResolvedValue(undefined),
  });
  const emitter = new ChainEventEmitter();
  const engine = new BeaconEngine({
    core,
    config,
    clock,
    emitter,
    logger,
    serializedCache: new SerializedCache(),
    beaconEngineWorker: true,
  });
  const view = new ReplicateChainView(await core.getChainViewSnapshot());
  engine.chainView = view;
  const order: string[] = [];
  const onChainViewUpdate = view.onChainViewUpdate.bind(view);
  vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
    const update = onChainViewUpdate(changes);
    order.push("view");
    return update;
  });
  for (const event of [routes.events.EventType.head, routes.events.EventType.headV2]) {
    emitter.on(event, () => order.push(event));
  }
  const coreEmit = vi.spyOn(events, "emit");
  const headPull = vi.spyOn(core, "getHeadSnapshot");
  return {
    core,
    engine,
    view,
    forkChoice,
    regen,
    preparedState,
    previous,
    next,
    config,
    clock,
    emitter,
    logger,
    order,
    coreEmit,
    headPull,
  };
}

describe("next-slot preparation head pull", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // updateAndGetHead() never moves checkpoints, so preparation only reports head changes
  it.each(["root", "payload", "unchanged"])("returns and pulls a %s update", async (change) => {
    const {engine, view, forkChoice, previous, next, order, coreEmit, headPull} = await setup();
    const head =
      change === "root" ? next : change === "payload" ? {...previous, payloadStatus: PayloadStatus.EMPTY} : previous;
    forkChoice.updateAndGetHead.mockImplementation(() => {
      forkChoice.getHead.mockReturnValue(head);
      return {head};
    });
    const response = await engine.prepareForNextSlot(clockSlot, opts);
    expect(response).toEqual({ok: true, data: null, headUpdate: change !== "unchanged"});
    expect(view.getHead()).toEqual(toChainViewBlock(head));
    expect(view.getJustifiedCheckpoint()).toEqual(structuredClone(forkChoice.getJustifiedCheckpoint()));
    expect(coreEmit).not.toHaveBeenCalled();
    if (change === "unchanged") {
      expect(headPull).not.toHaveBeenCalled();
      expect(order).toEqual([]);
    } else {
      expect(headPull).toHaveBeenCalledExactlyOnceWith({
        blockRoot: fromHex(previous.blockRoot),
        payloadStatus: previous.payloadStatus,
      });
      expect(order).toEqual(
        change === "root" ? ["view", "head", "head_v2"] : change === "payload" ? ["view", "head_v2"] : ["view"]
      );
    }
  });

  it("refreshes the head when preparation skips after recomputing it", async () => {
    const {engine, view, next, regen, coreEmit} = await setup();
    expect(await engine.prepareForNextSlot(3 * SLOTS_PER_EPOCH - 1, opts)).toEqual({
      ok: true,
      data: null,
      headUpdate: true,
    });
    expect(view.getHead()).toEqual(toChainViewBlock(next));
    expect(regen.getBlockSlotState).not.toHaveBeenCalled();
    expect(coreEmit).not.toHaveBeenCalled();
  });

  it.each([new Error("preparation failed"), new ErrorAborted("preparation cancelled")])(
    "refreshes the head before returning a preparation failure: %s",
    async (error) => {
      const {engine, view, next, regen, coreEmit, order} = await setup();
      regen.getBlockSlotState.mockRejectedValueOnce(error);
      const response = await engine.prepareForNextSlot(clockSlot, opts);
      expect(response).toEqual({
        ok: false,
        code: error instanceof ErrorAborted ? BeaconEngineErrorCode.ABORTED : BeaconEngineErrorCode.INTERNAL,
        payload: {message: error.message},
        headUpdate: true,
      });
      expect(view.getHead()).toEqual(toChainViewBlock(next));
      expect(order).toEqual(["view", "head", "head_v2"]);
      expect(coreEmit).not.toHaveBeenCalled();
    }
  );

  it.each([
    {changed: false, fail: false},
    {changed: true, fail: false},
    {changed: true, fail: true},
  ])("compares the canonical head after prediction, changed=$changed fail=$fail", async ({changed, fail}) => {
    const {engine, config, view, forkChoice, previous, next, regen, coreEmit, headPull} = await setup();
    vi.spyOn(config, "getForkName").mockReturnValue(ForkName.bellatrix);
    const preparedState = new BeaconStateView(generateCachedBellatrixState({slot: SLOTS_PER_EPOCH}));
    regen.getBlockSlotState.mockResolvedValue(preparedState);
    const proposerHead = {...previous, blockRoot: toRootHex(Buffer.alloc(32, 3)), slot: previous.slot - 1};
    forkChoice.updateAndGetHead.mockImplementation(({mode}) => {
      if (mode === UpdateHeadOpt.GetCanonicalHead) return {head: previous};
      forkChoice.getHead.mockReturnValue(changed ? next : previous);
      if (fail) throw new Error("prediction failed");
      return {head: proposerHead};
    });
    expect(await engine.prepareForNextSlot(clockSlot, opts)).toEqual(
      fail
        ? {
            ok: false,
            code: BeaconEngineErrorCode.INTERNAL,
            payload: {message: "prediction failed"},
            headUpdate: changed,
          }
        : {ok: true, data: null, headUpdate: changed}
    );
    expect(forkChoice.updateAndGetHead).toHaveBeenCalledTimes(2);
    if (!fail) expect(regen.getBlockSlotState.mock.calls.at(-1)?.[0]).toEqual(proposerHead);
    expect(view.getHead()).toEqual(toChainViewBlock(changed ? next : previous));
    expect(headPull).toHaveBeenCalledTimes(changed ? 1 : 0);
    expect(coreEmit).not.toHaveBeenCalled();
  });

  it("updates ChainView before the scheduler emits payload attributes", async () => {
    vi.useFakeTimers();
    const {core, engine, view, forkChoice, next, clock, config, emitter, logger, order} = await setup();
    const payloadAttributes = {version: ForkName.bellatrix, data: ssz.bellatrix.SSEPayloadAttributes.defaultValue()};
    vi.spyOn(core, "prepareForNextSlot").mockImplementation(async () => {
      forkChoice.getHead.mockReturnValue(next);
      return {ok: true, data: {payloadAttributes}, headUpdate: true};
    });
    const chain = Object.assign(Object.create(BeaconChain.prototype) as BeaconChain, {
      clock,
      emitter,
      beaconEngine: engine,
      getHead: () => view.getHead(),
    });
    const controller = new AbortController();
    const scheduler = new PrepareNextSlotScheduler(chain, config, null, logger, controller.signal);
    const onPayloadAttributes = vi.fn(() => {
      order.push("payload_attributes");
      return view.getHead();
    });
    emitter.on(routes.events.EventType.payloadAttributes, onPayloadAttributes);
    const preparing = scheduler.prepareForNextSlot(clockSlot);
    await vi.advanceTimersByTimeAsync(config.getSlotComponentDurationMs(ForkName.phase0, PREPARE_NEXT_SLOT_BPS));
    await preparing;
    expect(onPayloadAttributes).toHaveBeenCalledExactlyOnceWith(payloadAttributes);
    expect(onPayloadAttributes.mock.results[0].value).toEqual(toChainViewBlock(next));
    expect(order).toEqual(["view", "head", "head_v2", "payload_attributes"]);
    controller.abort();
  });

  it("pulls and emits when pending preparation finishes after close", async () => {
    const {engine, view, regen, preparedState, next, headPull, order, coreEmit} = await setup();
    const pending = defer<typeof preparedState>();
    regen.getBlockSlotState.mockReturnValueOnce(pending.promise);
    const preparing = engine.prepareForNextSlot(clockSlot, opts);
    expect(regen.getBlockSlotState).toHaveBeenCalledOnce();
    expect(order).toEqual([]);
    await engine.close();
    pending.resolve(preparedState);
    expect(await preparing).toEqual({ok: true, data: null, headUpdate: true});
    expect(view.getHead()).toEqual(toChainViewBlock(next));
    expect(headPull).toHaveBeenCalledOnce();
    expect(order).toEqual(["view", "head", "head_v2"]);
    expect(coreEmit).not.toHaveBeenCalled();
  });
});
