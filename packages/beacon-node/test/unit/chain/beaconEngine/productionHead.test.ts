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
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconEngineEventBus} from "../../../../src/chain/beaconEngine/events.js";
import {BeaconEngineErrorCode} from "../../../../src/chain/beaconEngine/interface.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BlockType, ProduceResult} from "../../../../src/chain/produceBlock/index.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

async function setup(fork: ForkName.bellatrix | ForkName.gloas) {
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
    beaconEngineWorker: true,
  });
  const view = new ReplicateChainView(await core.getChainViewSnapshot());
  engine.chainView = view;
  const onView = vi.fn();
  const onChainViewUpdate = view.onChainViewUpdate.bind(view);
  vi.spyOn(view, "onChainViewUpdate").mockImplementation((changes) => {
    const update = onChainViewUpdate(changes);
    onView();
    return update;
  });
  const onHead = vi.fn();
  emitter.on(routes.events.EventType.head, onHead);
  emitter.on(routes.events.EventType.headV2, onHead);
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
  };
}

describe.each([ForkName.bellatrix, ForkName.gloas] as const)("%s production head pull", (fork) => {
  // updateAndGetHead() never moves checkpoints, so production only reports head changes
  it.each(["root", "payload", "unchanged"])("refreshes a %s change without publishing head events", async (change) => {
    const {produce, view, forkChoice, previous, next, produceBlockWrapper, coreEmit, headPull, onView, onHead} =
      await setup(fork);
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
    expect(view.getHead()).toEqual(toChainViewBlock(head));
    expect(view.getJustifiedCheckpoint()).toEqual(forkChoice.getJustifiedCheckpoint());
    expect(coreEmit).not.toHaveBeenCalled();
    expect(onHead).not.toHaveBeenCalled();
    expect(forkChoice.getDependentRoot).not.toHaveBeenCalled();
    if (change === "unchanged") {
      expect(headPull).not.toHaveBeenCalled();
      expect(onView).not.toHaveBeenCalled();
    } else {
      expect(headPull).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(onView).toHaveBeenCalledOnce();
    }
  });

  it.each(["selection", "production"])("refreshes the canonical head before returning a %s failure", async (stage) => {
    const {produce, view, forkChoice, next, produceBlockWrapper, headPull, coreEmit, onHead} = await setup(fork);
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
    expect(view.getHead()).toEqual(toChainViewBlock(next));
    expect(headPull).toHaveBeenCalledOnce();
    expect(coreEmit).not.toHaveBeenCalled();
    expect(onHead).not.toHaveBeenCalled();
  });

  it("does not pull when validation fails before proposer selection", async () => {
    const {produce, request, forkChoice, headPull, onView, onHead} = await setup(fork);
    request.builderBoostFactor = MAX_BUILDER_BOOST_FACTOR + 1n;
    request.builderConfig.builderBoostFactor = MAX_BUILDER_BOOST_FACTOR + 1n;
    expect(await produce()).toMatchObject({ok: false, code: BeaconEngineErrorCode.API_ERROR, headUpdate: false});
    expect(forkChoice.updateAndGetHead).not.toHaveBeenCalled();
    expect(headPull).not.toHaveBeenCalled();
    expect(onView).not.toHaveBeenCalled();
    expect(onHead).not.toHaveBeenCalled();
  });

  it("does not pull or emit when pending production finishes after close", async () => {
    const {engine, produce, produced, produceBlockWrapper, headPull, onView, onHead} = await setup(fork);
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
    expect(headPull).not.toHaveBeenCalled();
    expect(onView).not.toHaveBeenCalled();
    expect(onHead).not.toHaveBeenCalled();
  });
});
