import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {SinonStubbedInstance} from "sinon";
import {BlockRepository} from "../../../../src/db/api/beacon/repositories";
import sinon from "sinon";
import {validateBlock} from "../../../../src/chain/blocks/validate";
import {ILMDGHOST, ArrayDagLMDGHOST} from "../../../../src/chain/forkChoice";
import {expect} from "chai";
import {getBlockSummary} from "../../../utils/headBlockInfo";
import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {silentLogger} from "../../../utils/logger";

describe("block validate stream", function () {
  const logger = silentLogger;
  let blockDbStub: SinonStubbedInstance<BlockRepository>;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

  beforeEach(function () {
    blockDbStub = sinon.createStubInstance(BlockRepository);
    forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    eventBusStub = sinon.createStubInstance(ChainEventEmitter);
  });

  it("should filter processed blocks", async function () {
    const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
    forkChoiceStub.hasBlock.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).returns(true);
    const result = await pipe(
      [{signedBlock: receivedBlock, trusted: false}],
      validateBlock(config, logger, forkChoiceStub, eventBusStub),
      all
    );
    expect(result).to.have.length(0);
  });

  it("should filter finalized blocks", async function () {
    const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
    receivedBlock.message.slot = 0;
    forkChoiceStub.hasBlock.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).returns(false);
    forkChoiceStub.getFinalized.returns({epoch: 1, root: Buffer.alloc(0)});
    const result = await pipe(
      [{signedBlock: receivedBlock, trusted: false}],
      validateBlock(config, logger, forkChoiceStub, eventBusStub),
      all
    );
    expect(result).to.have.length(0);
  });

  it("should allow valid blocks", async function () {
    const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
    receivedBlock.message.slot = 0;
    forkChoiceStub.hasBlock.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).returns(false);
    forkChoiceStub.getFinalized.returns({epoch: 0, root: Buffer.alloc(0)});
    forkChoiceStub.head.returns(getBlockSummary({blockRoot: Buffer.alloc(32, 0), slot: 0}));
    blockDbStub.get.resolves(config.types.SignedBeaconBlock.defaultValue());
    const result = await pipe(
      [{signedBlock: receivedBlock, trusted: false}],
      validateBlock(config, logger, forkChoiceStub, eventBusStub),
      all
    );
    expect(result).to.have.length(1);
  });
});
