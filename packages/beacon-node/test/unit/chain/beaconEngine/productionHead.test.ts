import {describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {PayloadStatus, UpdateHeadOpt} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, fromHex, toRootHex} from "@lodestar/utils";
import {MAX_BUILDER_BOOST_FACTOR} from "@lodestar/validator";
import {ApiError} from "../../../../src/api/impl/errors.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/utils.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine.js";
import {ForkChoiceChainView} from "../../../../src/chain/chainView/forkChoiceChainView.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BlockType, ProduceResult} from "../../../../src/chain/produceBlock/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

async function setup(fork: ForkName.bellatrix | ForkName.gloas, beaconEngineMode: BeaconEngineMode) {
  const config = createBeaconConfig(getConfig(fork), new Uint8Array(32));
  const clock = new ClockStopped(2);
  const previous = generateProtoBlock({
    slot: 0,
    blockRoot: toRootHex(Buffer.alloc(32, 1)),
    executionPayloadBlockHash: toRootHex(Buffer.alloc(32, 3)),
  });
  const next = {...previous, slot: 1, blockRoot: toRootHex(Buffer.alloc(32, 2)), parentRoot: previous.blockRoot};
  const checkpoint = {epoch: 0, root: fromHex(previous.blockRoot), rootHex: previous.blockRoot};
  const forkChoice = {
    getHead: vi.fn(() => previous),
    getAllNodes: vi.fn(() => [previous, next]),
    getJustifiedCheckpoint: vi.fn(() => checkpoint),
    getFinalizedCheckpoint: vi.fn(() => checkpoint),
    getDependentRoot: vi.fn(() => previous.blockRoot),
    shouldBuildOnFull: vi.fn(() => true),
    updateAndGetHead: vi.fn(() => {
      forkChoice.getHead.mockReturnValue(next);
      return {head: previous};
    }),
  };
  const block = ssz[fork].BeaconBlock.defaultValue();
  block.slot = clock.currentSlot;
  const produceResult: ProduceResult =
    fork === ForkName.bellatrix
      ? {type: BlockType.Full, fork, executionPayload: ssz.bellatrix.ExecutionPayload.defaultValue()}
      : {
          type: BlockType.Full,
          fork,
          executionPayload: ssz.gloas.ExecutionPayload.defaultValue(),
          executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
          blobsBundle: {blobs: [], commitments: [], proofs: []},
          cells: [],
          parentBlockRoot: fromHex(previous.blockRoot),
        };
  const produced = {block, produceResult, executionPayloadValue: 1n, consensusBlockValue: 0n};
  const produceBlockWrapper = vi.fn(
    async (_type: BlockType, attrs: Parameters<BeaconEngineCore["produceBlockWrapper"]>[1]) => {
      await attrs.commonBlockBodyPromise;
      block.parentRoot = fromHex(attrs.parentBlock.blockRoot);
      return produced;
    }
  );
  const events = new BeaconEngineEventBus();
  const logger = getMockedLogger();
  const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
    config,
    clock,
    emitter: events,
    logger,
    forkChoice,
    builderCircuitBreaker: {isActive: () => true},
    produceBlockWrapper,
    produceCommonBlockBody: vi.fn().mockResolvedValue(ssz.capella.BeaconBlockBody.defaultValue()),
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
    ...(beaconEngineMode === BeaconEngineMode.Worker ? {coreEmitter: core.emitter} : {}),
  });
  const view =
    beaconEngineMode === BeaconEngineMode.Worker
      ? new ReplicateChainView(await core.getChainViewSnapshot())
      : new ForkChoiceChainView(core);
  engine.chainView = view;
  const order: string[] = [];
  const onView = vi.fn();
  if (view instanceof ReplicateChainView) {
    const onChainViewUpdate = view.onChainViewUpdate.bind(view);
    vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
      const update = onChainViewUpdate(changes);
      order.push("view");
      onView();
      return update;
    });
  }
  const onHead = vi.fn();
  emitter.on(routes.events.EventType.head, (event) => {
    expect(view.getHead().blockRoot).toBe(event.block);
    order.push("head");
    onHead(event);
  });
  emitter.on(routes.events.EventType.headV2, (event) => {
    expect(view.getHead().blockRoot).toBe(event.data.block);
    expect(event.data.payloadStatus).toBe(view.getHead().payloadStatus === PayloadStatus.FULL ? "full" : "empty");
    order.push("head_v2");
    onHead(event);
  });
  const coreEmit = vi.spyOn(events, "emit");
  const headPull = vi.spyOn(core, "getHeadSnapshot");
  const request = {
    slot: clock.currentSlot,
    randaoReveal: new Uint8Array(96),
    graffiti: new Uint8Array(32),
    builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
    builderBoostFactor: 0n,
    includePayload: false,
    builderConfig: {minBid: 0n, builderBoostFactor: 0n, builders: []},
  };
  const produce = () => (fork === ForkName.bellatrix ? engine.produceBlock(request) : engine.produceBlockV4(request));
  return {
    core,
    engine,
    view,
    forkChoice,
    previous,
    next,
    request,
    produce,
    produced,
    produceBlockWrapper,
    coreEmit,
    headPull,
    onView,
    onHead,
    order,
  };
}

describe.each([
  [ForkName.bellatrix, BeaconEngineMode.MainThread],
  [ForkName.bellatrix, BeaconEngineMode.Worker],
  [ForkName.gloas, BeaconEngineMode.MainThread],
  [ForkName.gloas, BeaconEngineMode.Worker],
] as const)("%s production head pull (worker=%s)", (fork, beaconEngineMode) => {
  // updateAndGetHead() never moves checkpoints, so production only reports head changes
  it.each(["root", "payload", "unchanged"])("publishes a %s change after updating the view", async (change) => {
    const {produce, view, forkChoice, previous, next, produceBlockWrapper, coreEmit, headPull, onView, onHead, order} =
      await setup(fork, beaconEngineMode);
    const head =
      change === "root" ? next : change === "payload" ? {...previous, payloadStatus: PayloadStatus.EMPTY} : previous;
    forkChoice.updateAndGetHead.mockImplementation(() => {
      forkChoice.getHead.mockReturnValue(head);
      return {head: previous};
    });

    expect(await produce()).toMatchObject({ok: true, headUpdate: change !== "unchanged"});
    expect(forkChoice.updateAndGetHead).toHaveBeenCalledExactlyOnceWith({
      mode: UpdateHeadOpt.GetProposerHead,
      slot: 2,
      secFromSlot: 0,
    });
    expect(produceBlockWrapper.mock.calls[0][1].parentBlock).toBe(previous);
    expect(view.getHead()).toEqual(beaconEngineMode === BeaconEngineMode.Worker ? toChainViewBlock(head) : head);
    expect(view.getJustifiedCheckpoint()).toEqual(forkChoice.getJustifiedCheckpoint());
    expect(coreEmit).not.toHaveBeenCalled();
    if (change === "unchanged") {
      expect(headPull).not.toHaveBeenCalled();
      expect(onView).not.toHaveBeenCalled();
      expect(onHead).not.toHaveBeenCalled();
      expect(forkChoice.getDependentRoot).not.toHaveBeenCalled();
      expect(order).toEqual([]);
    } else {
      expect(headPull).toHaveBeenCalledExactlyOnceWith({
        blockRoot: fromHex(previous.blockRoot),
        payloadStatus: previous.payloadStatus,
      });
      expect(onView).toHaveBeenCalledTimes(beaconEngineMode === BeaconEngineMode.Worker ? 1 : 0);
      expect(onHead).toHaveBeenCalledTimes(change === "root" ? 2 : 1);
      expect(onHead).toHaveBeenCalledWith(
        expect.objectContaining({data: expect.objectContaining({block: head.blockRoot})})
      );
      expect(order).toEqual([
        ...(beaconEngineMode === BeaconEngineMode.Worker ? ["view"] : []),
        ...(change === "root" ? ["head"] : []),
        "head_v2",
      ]);
    }
  });

  it.each(["selection", "production"])("refreshes the canonical head before returning a %s failure", async (stage) => {
    const {produce, view, forkChoice, next, produceBlockWrapper, headPull, coreEmit, onHead, order} = await setup(
      fork,
      beaconEngineMode
    );
    if (stage === "selection") {
      forkChoice.updateAndGetHead.mockImplementation(() => {
        forkChoice.getHead.mockReturnValue(next);
        throw new ApiError(400, "proposer selection failed");
      });
    } else {
      produceBlockWrapper.mockImplementation(async (_type, attrs) => {
        await attrs.commonBlockBodyPromise;
        throw new Error("production failed");
      });
    }

    expect(await produce()).toMatchObject({
      ok: false,
      headUpdate: true,
      code: stage === "selection" ? BeaconEngineErrorCode.API_ERROR : BeaconEngineErrorCode.INTERNAL,
    });
    expect(view.getHead()).toEqual(beaconEngineMode === BeaconEngineMode.Worker ? toChainViewBlock(next) : next);
    expect(headPull).toHaveBeenCalledOnce();
    expect(coreEmit).not.toHaveBeenCalled();
    expect(onHead).toHaveBeenCalledTimes(2);
    expect(onHead).toHaveBeenCalledWith(expect.objectContaining({block: next.blockRoot}));
    expect(order).toEqual([...(beaconEngineMode === BeaconEngineMode.Worker ? ["view"] : []), "head", "head_v2"]);
  });

  it("does not pull when validation fails before proposer selection", async () => {
    const {produce, request, forkChoice, headPull, onView, onHead} = await setup(fork, beaconEngineMode);
    request.builderBoostFactor = MAX_BUILDER_BOOST_FACTOR + 1n;
    request.builderConfig.builderBoostFactor = MAX_BUILDER_BOOST_FACTOR + 1n;
    expect(await produce()).toMatchObject({ok: false, code: BeaconEngineErrorCode.API_ERROR, headUpdate: false});
    expect(forkChoice.updateAndGetHead).not.toHaveBeenCalled();
    expect(headPull).not.toHaveBeenCalled();
    expect(onView).not.toHaveBeenCalled();
    expect(onHead).not.toHaveBeenCalled();
  });

  it("pulls and emits when pending production finishes after close", async () => {
    const {engine, produce, produced, produceBlockWrapper, headPull, onView, onHead, order} = await setup(
      fork,
      beaconEngineMode
    );
    const pending = defer<void>();
    produceBlockWrapper.mockImplementation(async (_type, attrs) => {
      await attrs.commonBlockBodyPromise;
      await pending.promise;
      return produced;
    });
    const production = produce();
    expect(produceBlockWrapper).toHaveBeenCalledOnce();
    await engine.close();
    pending.resolve();

    expect(await production).toMatchObject({ok: true, headUpdate: true});
    expect(headPull).toHaveBeenCalledOnce();
    expect(onView).toHaveBeenCalledTimes(beaconEngineMode === BeaconEngineMode.Worker ? 1 : 0);
    expect(onHead).toHaveBeenCalledTimes(2);
    expect(order).toEqual([...(beaconEngineMode === BeaconEngineMode.Worker ? ["view"] : []), "head", "head_v2"]);
  });
});
