import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {SinonStubbedInstance} from "sinon";
import {BlockRepository} from "../../../../src/db/api/beacon/repositories";
import {BeaconDb} from "../../../../src/db/api";
import sinon from "sinon";
import {validateBlock} from "../../../../src/chain/blocks/validate";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain/forkChoice";
import {collect} from "./utils";
import { expect } from "chai";

describe("block validate stream", function () {

    let blockDbStub: SinonStubbedInstance<BlockRepository>;
    let dbStub: SinonStubbedInstance<BeaconDb>;
    let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;

    beforeEach(function () {
        dbStub = sinon.createStubInstance(BeaconDb);
        blockDbStub = sinon.createStubInstance(BlockRepository);
        dbStub.block = blockDbStub as unknown as BlockRepository;
        forkChoiceStub = sinon.createStubInstance(StatefulDagLMDGHOST);
    });

    it("should filter processed blocks", async function () {
        const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
        blockDbStub.has.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).resolves(true);
        const result = await pipe(
            [{signedBlock: receivedBlock, trusted: false}],
            validateBlock(config, sinon.createStubInstance(WinstonLogger), dbStub, forkChoiceStub),
            collect
        );
        expect(result).to.have.length(0);
    });

    it("should filter finalized blocks", async function () {
        const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
        receivedBlock.message.slot = 0;
        blockDbStub.has.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).resolves(false);
        forkChoiceStub.getFinalized.returns({epoch: 0, root: Buffer.alloc(0)});
        const result = await pipe(
            [{signedBlock: receivedBlock, trusted: false}],
            validateBlock(config, sinon.createStubInstance(WinstonLogger), dbStub, forkChoiceStub),
            collect
        );
        expect(result).to.have.length(0);
    });

    it("should allow valid blocks", async function () {
        const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
        receivedBlock.message.slot = config.params.SLOTS_PER_EPOCH;
        blockDbStub.has.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).resolves(false);
        forkChoiceStub.getFinalized.returns({epoch: 0, root: Buffer.alloc(0)});
        forkChoiceStub.head.returns(Buffer.alloc(0));
        blockDbStub.get.resolves(config.types.SignedBeaconBlock.defaultValue());
        const result = await pipe(
            [{signedBlock: receivedBlock, trusted: false}],
            validateBlock(config, sinon.createStubInstance(WinstonLogger), dbStub, forkChoiceStub),
            collect
        );
        expect(result).to.have.length(1);
    });

});