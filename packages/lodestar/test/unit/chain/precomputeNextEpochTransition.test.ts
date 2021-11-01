import {config} from "@chainsafe/lodestar-config/default";
import {AbortController} from "@chainsafe/abort-controller";
import {ForkChoice, IProtoBlock} from "@chainsafe/lodestar-fork-choice";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter} from "../../../src/chain";
import {LocalClock} from "../../../src/chain/clock";
import {PrecomputeNextEpochTransitionScheduler} from "../../../src/chain/precomputeNextEpochTransition";
import {StateRegenerator} from "../../../src/chain/regen";

describe("PrecomputeEpochScheduler", () => {
  const sandbox = sinon.createSandbox();
  const abortController = new AbortController();

  let preComputeScheduler: PrecomputeNextEpochTransitionScheduler;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice> & ForkChoice;
  let regenStub: SinonStubbedInstance<StateRegenerator> & StateRegenerator;
  let loggerStub: SinonStubbedInstance<WinstonLogger> & WinstonLogger;

  beforeEach(() => {
    sandbox.useFakeTimers();
    const chainStub = sandbox.createStubInstance(BeaconChain) as SinonStubbedInstance<BeaconChain> & BeaconChain;
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
    preComputeScheduler = new PrecomputeNextEpochTransitionScheduler(
      chainStub,
      config,
      null,
      loggerStub,
      abortController.signal
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not run due to not last slot of epoch", async () => {
    await preComputeScheduler.prepareForNextEpoch(3);
    expect(forkChoiceStub.getHead.called).to.be.false;
  });

  it("should skip, headSlot is less than clock slot", async () => {
    forkChoiceStub.getHead.returns({slot: SLOTS_PER_EPOCH - 2} as IProtoBlock);
    await Promise.all([
      preComputeScheduler.prepareForNextEpoch(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(forkChoiceStub.getHead.called, "expect forkChoice.getHead to be called").to.be.true;
    expect(regenStub.getBlockSlotState.called, "expect regen.getBlockSlotState not to be called").to.be.false;
  });

  it("should run regen.getBlockSlotState", async () => {
    forkChoiceStub.getHead.returns({slot: SLOTS_PER_EPOCH - 1} as IProtoBlock);
    regenStub.getBlockSlotState.resolves();
    await Promise.all([
      preComputeScheduler.prepareForNextEpoch(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(forkChoiceStub.getHead.called, "expect forkChoice.getHead to be called").to.be.true;
    expect(regenStub.getBlockSlotState.called, "expect regen.getBlockSlotState to be called").to.be.true;
  });

  it("should handle regen.getBlockSlotState error", async () => {
    forkChoiceStub.getHead.returns({slot: SLOTS_PER_EPOCH - 1} as IProtoBlock);
    regenStub.getBlockSlotState.rejects("Unit test error");
    expect(loggerStub.error.calledOnce).to.be.false;
    await Promise.all([
      preComputeScheduler.prepareForNextEpoch(SLOTS_PER_EPOCH - 1),
      sandbox.clock.tickAsync((config.SECONDS_PER_SLOT * 1000 * 2) / 3),
    ]);
    expect(forkChoiceStub.getHead.called, "expect forkChoice.getHead to be called").to.be.true;
    expect(regenStub.getBlockSlotState.called, "expect regen.getBlockSlotState to be called").to.be.true;
    expect(loggerStub.error.calledOnce, "expect log error on rejected regen.getBlockSlotState").to.be.true;
  });
});
