import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {expect} from "chai";
import {BeaconChain, ChainEventEmitter, StatefulDagLMDGHOST} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {postProcess} from "../../../../src/chain/blocks/post";
import {BeaconMetrics, IBeaconMetrics} from "../../../../src/metrics";
import {Gauge} from "prom-client";
import {AttestationProcessor} from "../../../../src/chain/attestation";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {StubbedBeaconDb} from "../../../utils/stub";

describe("post block process stream", function () {

  let epochCtxStub: SinonStubbedInstance<EpochContext>;
  let forkChoiceStub: SinonStubbedInstance<StatefulDagLMDGHOST>;
  let dbStub: StubbedBeaconDb;
  let metricsStub: SinonStubbedInstance<IBeaconMetrics>;
  let slotMetricsStub: SinonStubbedInstance<Gauge>;
  let currentEpochLiveValidatorsMetricsStub: SinonStubbedInstance<Gauge>;
  let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;
  let attestationProcessorStub: SinonStubbedInstance<AttestationProcessor>;

  beforeEach(function () {
    epochCtxStub = sinon.createStubInstance(EpochContext);
    epochCtxStub.currentShuffling = {
      activeIndices: [],
    } as any;
    forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    dbStub = new StubbedBeaconDb(sinon);
    slotMetricsStub = sinon.createStubInstance(Gauge);
    currentEpochLiveValidatorsMetricsStub = sinon.createStubInstance(Gauge);
    metricsStub = sinon.createStubInstance(BeaconMetrics);
    metricsStub.currentSlot = slotMetricsStub as unknown as Gauge;
    metricsStub.currentEpochLiveValidators = currentEpochLiveValidatorsMetricsStub as unknown as Gauge;
    metricsStub.currentFinalizedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
    metricsStub.currentJustifiedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
    metricsStub.previousJustifiedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
    eventBusStub = sinon.createStubInstance(BeaconChain);
    attestationProcessorStub = sinon.createStubInstance(AttestationProcessor);
    forkChoiceStub.getCanonicalBlockSummaryAtSlot.returns({
      blockRoot: Buffer.alloc(32),
      stateRoot: Buffer.alloc(32),
      parentRoot: Buffer.alloc(32),
    } as any);
  });

  it("no epoch transition", async function () {
    const preState = generateState();
    const postState = generateState();
    const block = config.types.SignedBeaconBlock.defaultValue();
    const item = {
      preState,
      postState,
      block
    };
    await pipe(
      [item],
      postProcess(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        epochCtxStub as unknown as EpochContext,
        forkChoiceStub,
        metricsStub,
        eventBusStub,
        attestationProcessorStub,
      ),
    );
    expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
  });

  it("epoch transition", async function () {
    const preState = generateState();
    const postState = generateState({slot: config.params.SLOTS_PER_EPOCH});
    const block = config.types.SignedBeaconBlock.defaultValue();
    block.message.body.attestations = [generateEmptyAttestation()];
    const item = {
      preState,
      postState,
      block
    };
    await pipe(
      [item],
      postProcess(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        epochCtxStub as unknown as EpochContext,
        forkChoiceStub,
        metricsStub,
        eventBusStub,
        attestationProcessorStub,
      ),
    );
    expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
    // @ts-ignore
    expect(eventBusStub.emit.withArgs("processedCheckpoint").calledOnce).to.be.true;
    // @ts-ignore
    expect(dbStub.processBlockOperations.calledOnce).to.be.true;
    expect(attestationProcessorStub.receiveBlock.calledOnce).to.be.true;
  });

  it("epoch transition - justified and finalized", async function () {
    const preState = generateState();
    const postState = generateState({
      slot: config.params.SLOTS_PER_EPOCH,
      currentJustifiedCheckpoint: {epoch: 1, root: Buffer.alloc(1)},
      finalizedCheckpoint: {epoch: 1, root: Buffer.alloc(1)}
    });
    const block = config.types.SignedBeaconBlock.defaultValue();
    block.message.body.attestations = [generateEmptyAttestation()];
    const item = {
      preState,
      postState,
      block
    };
    dbStub.block.get.resolves(block);
    await pipe(
      [item],
      postProcess(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        epochCtxStub as unknown as EpochContext,
        forkChoiceStub,
        metricsStub,
        eventBusStub,
        attestationProcessorStub,
      ),
    );
    expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
    // @ts-ignore
    expect(eventBusStub.emit.withArgs("processedCheckpoint").calledOnce).to.be.true;
    // @ts-ignore
    expect(dbStub.processBlockOperations.calledOnce).to.be.true;
    expect(attestationProcessorStub.receiveBlock.calledOnce).to.be.true;
  });

});
