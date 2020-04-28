import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {
    BlockRepository,
    ChainRepository,
    DepositDataRepository,
    StateRepository,
    DepositDataRootListRepository
} from "../../../../src/db/api/beacon/repositories";
import {BeaconDb} from "../../../../src/db/api";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain/forkChoice";
import {collect} from "./utils";
import {expect} from "chai";
import {IBlockProcessJob, ChainEventEmitter, BeaconChain} from "../../../../src/chain";
import {BlockPool} from "../../../../src/chain/blocks/pool";
import {processBlock} from "../../../../src/chain/blocks/process";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition";
import {generateState} from "../../../utils/state";
import {List, TreeBacked} from "@chainsafe/ssz";
import {Root} from "@chainsafe/lodestar-types";

describe("block process stream", function () {

    let blockDbStub: SinonStubbedInstance<BlockRepository>;
    let stateDbStub: SinonStubbedInstance<StateRepository>;
    let chainDbStub: SinonStubbedInstance<ChainRepository>;
    let depositDataDbStub: SinonStubbedInstance<DepositDataRepository>;
    let depositDataRootListDbStub: SinonStubbedInstance<DepositDataRootListRepository>;
    let dbStub: SinonStubbedInstance<BeaconDb>;
    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
    let blockPoolStub: SinonStubbedInstance<BlockPool>;
    let stateTransitionStub: SinonStub;
    let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

    const sandbox = sinon.createSandbox();

    beforeEach(function () {
        dbStub = sinon.createStubInstance(BeaconDb);
        blockDbStub = sinon.createStubInstance(BlockRepository);
        stateDbStub = sinon.createStubInstance(StateRepository);
        chainDbStub = sinon.createStubInstance(ChainRepository);
        depositDataRootListDbStub = sinon.createStubInstance(DepositDataRootListRepository);
        depositDataDbStub = sinon.createStubInstance(DepositDataRepository);
        dbStub.block = blockDbStub as unknown as BlockRepository;
        dbStub.state = stateDbStub as unknown as StateRepository;
        dbStub.chain = chainDbStub as unknown as ChainRepository;
        dbStub.depositData = depositDataDbStub as unknown as DepositDataRepository;
        dbStub.depositDataRootList = depositDataRootListDbStub as unknown as DepositDataRootListRepository;
        blockPoolStub = sinon.createStubInstance(BlockPool);
        forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
        stateTransitionStub = sandbox.stub(stateTransitionUtils, "stateTransition");
        eventBusStub = sinon.createStubInstance(BeaconChain);
    });

    afterEach(function () {
        sandbox.restore();
    });

    it("missing parent block", async function () {
        const receivedJob: IBlockProcessJob = {
          signedBlock: config.types.SignedBeaconBlock.defaultValue(),
          trusted: false
        };
        blockDbStub.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(null);
        const result = await pipe(
            [receivedJob],
            processBlock(config, dbStub, sinon.createStubInstance(WinstonLogger), forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub),
            collect
        );
        expect(result).to.have.length(0);
        expect(blockPoolStub.addPendingBlock.calledOnce).to.be.true;
    });

    it("missing parent state", async function () {
        const receivedJob: IBlockProcessJob = {
          signedBlock: config.types.SignedBeaconBlock.defaultValue(),
          trusted: false
        };
        const parentBlock = config.types.SignedBeaconBlock.defaultValue();
        blockDbStub.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
        stateDbStub.get.resolves(null);
        const result = await pipe(
            [receivedJob],
            processBlock(config, dbStub, sinon.createStubInstance(WinstonLogger), forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub),
            collect
        );
        expect(result).to.have.length(0);
    });

    it("failed state transition", async function () {
        const receivedJob: IBlockProcessJob = {
          signedBlock: config.types.SignedBeaconBlock.defaultValue(),
          trusted: false
        };
        const parentBlock = config.types.SignedBeaconBlock.defaultValue();
        blockDbStub.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
        stateDbStub.get.resolves(generateState());
        stateTransitionStub.throws();
        const result = await pipe(
            [receivedJob],
            processBlock(config, dbStub, sinon.createStubInstance(WinstonLogger), forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub),
            collect
        );
        expect(result).to.have.length(0);
        expect(blockDbStub.storeBadBlock.calledOnce).to.be.true;
    });

    it("successful block process - not new chain head", async function () {
        const receivedJob: IBlockProcessJob = {
          signedBlock: config.types.SignedBeaconBlock.defaultValue(),
          trusted: false
        };
        const parentBlock = config.types.SignedBeaconBlock.defaultValue();
        blockDbStub.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
        stateDbStub.get.resolves(generateState());
        stateTransitionStub.resolves(generateState());
        chainDbStub.getChainHeadRoot.resolves(Buffer.alloc(32, 1));
        forkChoiceStub.head.returns(Buffer.alloc(32, 1));
        const result = await pipe(
            [receivedJob],
            processBlock(config, dbStub, sinon.createStubInstance(WinstonLogger), forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub),
            collect
        );
        expect(result).to.have.length(1);
        expect(blockDbStub.storeBadBlock.notCalled).to.be.true;
        expect(blockDbStub.set.calledOnce).to.be.true;
        expect(stateDbStub.set.calledOnce).to.be.true;
        expect(dbStub.updateChainHead.notCalled).to.be.true;
        expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
    });

    it("successful block process - new chain head", async function () {
        const receivedJob: IBlockProcessJob = {
          signedBlock: config.types.SignedBeaconBlock.defaultValue(),
          trusted: false
        };
        const parentBlock = config.types.SignedBeaconBlock.defaultValue();
        blockDbStub.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
        stateDbStub.get.resolves(generateState());
        stateTransitionStub.resolves(generateState());
        chainDbStub.getChainHeadRoot.resolves(Buffer.alloc(32, 1));
        forkChoiceStub.head.returns(Buffer.alloc(32, 2));
        depositDataDbStub.getAllBetween.resolves([]);
        depositDataRootListDbStub.get.resolves(config.types.DepositDataRootList.defaultValue().valueOf() as TreeBacked<List<Root>>);
        blockDbStub.get.resolves(receivedJob.signedBlock);
        const result = await pipe(
            [receivedJob],
            processBlock(config, dbStub, sinon.createStubInstance(WinstonLogger), forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub),
            collect
        );
        expect(result).to.have.length(1);
        expect(blockDbStub.storeBadBlock.notCalled).to.be.true;
        expect(blockDbStub.set.calledOnce).to.be.true;
        expect(stateDbStub.set.calledOnce).to.be.true;
        expect(dbStub.updateChainHead.calledOnce).to.be.true;
        expect(depositDataRootListDbStub.set.calledOnce).to.be.true;
        expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
    });
});