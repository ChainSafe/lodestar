import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {SinonStubbedInstance} from "sinon";
import {BlockRepository} from "../../../../src/db/api/beacon/repositories";
import sinon from "sinon";
import {validateBlock} from "../../../../src/chain/blocks/validate";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST, ArrayDagLMDGHOST} from "../../../../src/chain/forkChoice";
import {collect} from "./utils";
import {expect} from "chai";
import {getBlockSummary} from "../../../utils/headBlockInfo";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";

describe("block validate stream", function () {
  let blockDbStub: SinonStubbedInstance<BlockRepository>;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;


  beforeEach(function () {
    blockDbStub = sinon.createStubInstance(BlockRepository);
    forkChoiceStub = sinon.createStubInstance(ArrayDagLMDGHOST);
    chainStub = sinon.createStubInstance(BeaconChain);
  });

  it("should filter processed blocks", async function () {
    const receivedBlock = config.types.SignedBeaconBlock.defaultValue();
    forkChoiceStub.hasBlock.withArgs(config.types.BeaconBlock.hashTreeRoot(receivedBlock.message)).returns(true);
    const result = await pipe(
      [{signedBlock: receivedBlock, trusted: false}],
      validateBlock(config, sinon.createStubInstance(WinstonLogger), forkChoiceStub, chainStub),
      collect
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
      validateBlock(config, sinon.createStubInstance(WinstonLogger), forkChoiceStub, chainStub),
      collect
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
      validateBlock(config, sinon.createStubInstance(WinstonLogger), forkChoiceStub, chainStub),
      collect
    );
    expect(result).to.have.length(1);
  });
});
