import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {BlockRepository, ChainRepository} from "../../../../src/db/api/beacon/repositories";
import {BeaconDb} from "../../../../src/db/api";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {expect} from "chai";
import {BeaconChain, ChainEventEmitter} from "../../../../src/chain";
import {generateState} from "../../../utils/state";
import {postProcess} from "../../../../src/chain/blocks/post";
import {BeaconMetrics, IBeaconMetrics} from "../../../../src/metrics";
import {Gauge} from "prom-client";

describe("post block process stream", function () {

    let blockDbStub: SinonStubbedInstance<BlockRepository>;
    let chainDbStub: SinonStubbedInstance<ChainRepository>;
    let dbStub: SinonStubbedInstance<BeaconDb>;
    let metricsStub: SinonStubbedInstance<IBeaconMetrics>;
    let slotMetricsStub: SinonStubbedInstance<Gauge>;
    let currentEpochLiveValidatorsMetricsStub: SinonStubbedInstance<Gauge>;
    let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

    beforeEach(function () {
        dbStub = sinon.createStubInstance(BeaconDb);
        blockDbStub = sinon.createStubInstance(BlockRepository);
        chainDbStub = sinon.createStubInstance(ChainRepository);
        dbStub.block = blockDbStub as unknown as BlockRepository;
        dbStub.chain = chainDbStub as unknown as ChainRepository;
        slotMetricsStub = sinon.createStubInstance(Gauge);
        currentEpochLiveValidatorsMetricsStub = sinon.createStubInstance(Gauge);
        metricsStub = sinon.createStubInstance(BeaconMetrics);
        metricsStub.currentSlot = slotMetricsStub as unknown as Gauge;
        metricsStub.currentEpochLiveValidators = currentEpochLiveValidatorsMetricsStub as unknown as Gauge;
        metricsStub.currentFinalizedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
        metricsStub.currentJustifiedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
        metricsStub.previousJustifiedEpoch = sinon.createStubInstance(Gauge) as unknown as Gauge;
        eventBusStub = sinon.createStubInstance(BeaconChain);
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
            postProcess(config, dbStub, sinon.createStubInstance(WinstonLogger), metricsStub, eventBusStub),
        );
        expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
    });

    it("epoch transition", async function () {
        const preState = generateState();
        const postState = generateState({slot: config.params.SLOTS_PER_EPOCH});
        const block = config.types.SignedBeaconBlock.defaultValue();
        const item = {
            preState,
            postState,
            block
        };
        await pipe(
            [item],
            postProcess(config, dbStub, sinon.createStubInstance(WinstonLogger), metricsStub, eventBusStub),
        );
        expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
        // @ts-ignore
        expect(eventBusStub.emit.withArgs("processedCheckpoint").calledOnce).to.be.true;
        expect(chainDbStub.setFinalizedBlockRoot.notCalled).to.be.true;
        expect(chainDbStub.setJustifiedBlockRoot.notCalled).to.be.true;
        expect(chainDbStub.setFinalizedStateRoot.notCalled).to.be.true;
        expect(chainDbStub.setJustifiedStateRoot.notCalled).to.be.true;
    });

    it("epoch transition - justified and finalized", async function () {
        const preState = generateState();
        const postState = generateState({
            slot: config.params.SLOTS_PER_EPOCH,
            currentJustifiedCheckpoint: {epoch: 1, root: Buffer.alloc(1)},
            finalizedCheckpoint: {epoch: 1, root: Buffer.alloc(1)}
        });
        const block = config.types.SignedBeaconBlock.defaultValue();
        const item = {
            preState,
            postState,
            block
        };
        blockDbStub.get.resolves(block);
        await pipe(
            [item],
            postProcess(config, dbStub, sinon.createStubInstance(WinstonLogger), metricsStub, eventBusStub),
        );
        expect(slotMetricsStub.set.withArgs(0).calledOnce).to.be.true;
        // @ts-ignore
        expect(eventBusStub.emit.withArgs("processedCheckpoint").calledOnce).to.be.true;
        expect(chainDbStub.setFinalizedBlockRoot.calledOnce).to.be.true;
        expect(chainDbStub.setJustifiedBlockRoot.calledOnce).to.be.true;
        expect(chainDbStub.setFinalizedStateRoot.calledOnce).to.be.true;
        expect(chainDbStub.setJustifiedStateRoot.calledOnce).to.be.true;
    });

});