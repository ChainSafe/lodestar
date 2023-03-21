import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";
import {config} from "@lodestar/config/default";
import {ForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {WinstonLogger} from "@lodestar/utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconChain, ChainEventEmitter} from "../../../src/chain/index.js";
import {IBeaconChain} from "../../../src/chain/interface.js";
import {LocalClock} from "../../../src/chain/clock/index.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {StateRegenerator} from "../../../src/chain/regen/index.js";
import {SinonStubFn} from "../../utils/types.js";
import {generateCachedBellatrixState} from "../../utils/state.js";
import {BeaconProposerCache} from "../../../src/chain/beaconProposerCache.js";
import {PayloadIdCache} from "../../../src/execution/engine/payloadIdCache.js";
import {ExecutionEngineHttp} from "../../../src/execution/engine/http.js";
import {IExecutionEngine} from "../../../src/execution/engine/interface.js";
import {StubbedChainMutable} from "../../utils/stub/index.js";

type StubbedChain = StubbedChainMutable<"clock" | "forkChoice" | "emitter" | "regen">;

describe("PrepareNextSlot scheduler", () => {
  const sandbox = sinon.createSandbox();
  const abortController = new AbortController();

  let chainStub: StubbedChain;
  let scheduler: PrepareNextSlotScheduler;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;
  let regenStub: SinonStubbedInstance<StateRegenerator> & StateRegenerator;
  let loggerStub: SinonStubbedInstance<WinstonLogger> & WinstonLogger;
  let beaconProposerCacheStub: SinonStubbedInstance<BeaconProposerCache> & BeaconProposerCache;
  let getForkStub: SinonStubFn<typeof config["getForkName"]>;
  let updateBuilderStatus: SinonStubFn<IBeaconChain["updateBuilderStatus"]>;
  let executionEngineStub: SinonStubbedInstance<ExecutionEngineHttp> & ExecutionEngineHttp;

  beforeEach(() => {
    sandbox.useFakeTimers();
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    updateBuilderStatus = chainStub.updateBuilderStatus;
    const clockStub = sandbox.createStubInstance(LocalClock) as SinonStubbedInstance<LocalClock> & LocalClock;
    chainStub.clock = clockStub;
    forkChoiceStub = sandbox.createStubInstance(ForkChoice) as SinonStubbedInstance<ForkChoice> & ForkChoice;
    chainStub.forkChoice = forkChoiceStub;
    const emitterStub = sandbox.createStubInstance(ChainEventEmitter) as SinonStubbedInstance<ChainEventEmitter> &
      ChainEventEmitter;
    chainStub.emitter = emitterStub;
    regenStub = sandbox.createStubInstance(StateRegenerator) as SinonStubbedInstance<StateRegenerator> &
      StateRegenerator;
    chainStub.regen = regenStub;
    loggerStub = sandbox.createStubInstance(WinstonLogger) as SinonStubbedInstance<WinstonLogger> & WinstonLogger;
    beaconProposerCacheStub = sandbox.createStubInstance(
      BeaconProposerCache
    ) as SinonStubbedInstance<BeaconProposerCache> & BeaconProposerCache;
    ((chainStub as unknown) as {beaconProposerCache: BeaconProposerCache})[
      "beaconProposerCache"
    ] = beaconProposerCacheStub;
    getForkStub = sandbox.stub(config, "getForkName");
    executionEngineStub = sandbox.createStubInstance(ExecutionEngineHttp) as SinonStubbedInstance<ExecutionEngineHttp> &
      ExecutionEngineHttp;
    ((chainStub as unknown) as {executionEngine: IExecutionEngine}).executionEngine = executionEngineStub;
    ((chainStub as unknown) as {config: ChainForkConfig}).config = (config as unknown) as ChainForkConfig;
    scheduler = new PrepareNextSlotScheduler(chainStub, config, null, loggerStub, abortController.signal);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("pre bellatrix - should not run due to not last slot of epoch", async () => {
    getForkStub.returns(ForkName.phase0);
    await scheduler.prepareForNextSlot(3);
    expect(chainStub.recomputeForkChoiceHead).not.to.be.called;
  });

  it("pre bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.returns(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState not to be called").not.to.be.called;
  });

  it("pre bellatrix - should run regen.getBlockSlotState", async () => {
    getForkStub.returns(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    regenStub.getBlockSlotState.resolves();
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState to be called").to.be.called;
  });

  it("pre bellatrix - should handle regen.getBlockSlotState error", async () => {
    getForkStub.returns(ForkName.phase0);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 1} as ProtoBlock);
    regenStub.getBlockSlotState.rejects("Unit test error");
    expect(loggerStub.error).to.not.be.called;
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState to be called").to.be.called;
    expect(loggerStub.error, "expect log error on rejected regen.getBlockSlotState").to.be.calledOnce;
  });

  it("bellatrix - should skip, headSlot is more than 1 epoch to prepare slot", async () => {
    getForkStub.returns(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 2} as ProtoBlock);
    await Promise.all([
      scheduler.prepareForNextSlot(2 * SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState not to be called").not.to.be.called;
  });

  it("bellatrix - should skip, no block proposer", async () => {
    getForkStub.returns(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    const state = generateCachedBellatrixState();
    regenStub.getBlockSlotState.resolves(state);
    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState to be called").to.be.called;
  });

  it("bellatrix - should prepare payload", async () => {
    getForkStub.returns(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.returns({slot: SLOTS_PER_EPOCH - 3} as ProtoBlock);
    forkChoiceStub.getJustifiedBlock.returns({} as ProtoBlock);
    forkChoiceStub.getFinalizedBlock.returns({} as ProtoBlock);
    updateBuilderStatus.returns(void 0);
    const state = generateCachedBellatrixState();
    regenStub.getBlockSlotState.resolves(state);
    beaconProposerCacheStub.get.returns("0x fee recipient address");
    ((executionEngineStub as unknown) as {payloadIdCache: PayloadIdCache}).payloadIdCache = new PayloadIdCache();

    await Promise.all([
      scheduler.prepareForNextSlot(SLOTS_PER_EPOCH - 2),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);

    expect(chainStub.recomputeForkChoiceHead, "expect updateHead to be called").to.be.called;
    expect(regenStub.getBlockSlotState, "expect regen.getBlockSlotState to be called").to.be.called;
    expect(updateBuilderStatus, "expect updateBuilderStatus to be called").to.be.called;
    expect(forkChoiceStub.getJustifiedBlock, "expect forkChoice.getJustifiedBlock to be called").to.be.called;
    expect(forkChoiceStub.getFinalizedBlock, "expect forkChoice.getFinalizedBlock to be called").to.be.called;
    expect(executionEngineStub.notifyForkchoiceUpdate, "expect executionEngine.notifyForkchoiceUpdate to be called").to
      .be.calledOnce;
  });
});
