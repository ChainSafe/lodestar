import {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter, IBlockProcessJob} from "../../../../src/chain";
import pushable, {Pushable} from "it-pushable";
import {BlockPool} from "../../../../src/chain/blocks/pool";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon from "sinon";
import { expect } from "chai";

describe("block pool", function () {

    let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;
    let sourceStub: SinonStubbedInstance<Pushable<IBlockProcessJob>>&AsyncIterable<IBlockProcessJob>;

    beforeEach(function () {
        eventBusStub = sinon.createStubInstance(BeaconChain);
        sourceStub = {
            ...pushable<IBlockProcessJob>(),
            push: sinon.stub(),
            end: sinon.stub()
        }
    });

    it("should add pending blocks", function () {
        const pool = new BlockPool(config, sourceStub, eventBusStub);
        pool.addPendingBlock({
            signedBlock: config.types.SignedBeaconBlock.defaultValue(),
            trusted: false
        });
        const differentParentRoot = config.types.SignedBeaconBlock.defaultValue();
        differentParentRoot.message.parentRoot = Buffer.alloc(32, 1);
        pool.addPendingBlock({
            signedBlock: differentParentRoot,
            trusted: false
        });
        pool.addPendingBlock({
            signedBlock: config.types.SignedBeaconBlock.defaultValue(),
            trusted: false
        });

        expect(
            // @ts-ignore
            eventBusStub.emit.withArgs("unknownBlockRoot", config.types.SignedBeaconBlock.defaultValue().message.parentRoot).callCount
        ).to.be.equal(1);
        expect(
            // @ts-ignore
            eventBusStub.emit.withArgs("unknownBlockRoot", differentParentRoot.message.parentRoot).callCount
        ).to.be.equal(1);
    });

    it("should remove block when parent found", function () {
        const pool = new BlockPool(config, sourceStub, eventBusStub);
        const requiredBlock = config.types.SignedBeaconBlock.defaultValue();
        const pendingBlock = config.types.SignedBeaconBlock.defaultValue();
        pendingBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(requiredBlock.message);
        pool.addPendingBlock({
            signedBlock: pendingBlock,
            trusted: false
        });

        pool.onProcessedBlock(requiredBlock);
        pool.addPendingBlock({
            signedBlock: pendingBlock,
            trusted: false
        });
        expect(sourceStub.push.calledOnce).to.be.true;
        expect(eventBusStub.emit.calledTwice).to.be.true;
    });

    it("should sort pending blocks", function () {
        const pool = new BlockPool(config, sourceStub, eventBusStub);
        const requiredBlock = config.types.SignedBeaconBlock.defaultValue();
        const pendingBlock = config.types.SignedBeaconBlock.defaultValue();
        pendingBlock.message.parentRoot = config.types.BeaconBlock.hashTreeRoot(requiredBlock.message);
        pendingBlock.message.slot = 3;
        const pendingBlock2 = config.types.SignedBeaconBlock.clone(pendingBlock);
        pendingBlock2.message.slot = 2;
        pool.addPendingBlock({
            signedBlock: pendingBlock,
            trusted: false
        });
        pool.addPendingBlock({
            signedBlock: pendingBlock2,
            trusted: false
        });
        pool.onProcessedBlock(requiredBlock);

        expect(sourceStub.push.calledTwice).to.be.true;
        expect(sourceStub.push.firstCall.calledWith({signedBlock: pendingBlock2, trusted: false})).to.be.true;
        expect(sourceStub.push.secondCall.calledWith({signedBlock: pendingBlock, trusted: false})).to.be.true;
    });

    it("should proceed without pending blocks", function () {
        const pool = new BlockPool(config, sourceStub, eventBusStub);

        pool.onProcessedBlock(config.types.SignedBeaconBlock.defaultValue());
        expect(sourceStub.push.notCalled).to.be.true;
        expect(eventBusStub.emit.notCalled).to.be.true;
    })
});