import {expect} from "chai";
import all from "it-all";
import pipe from "it-pipe";
import sinon, {SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter} from "../../../../src/chain";
import {validateBlock} from "../../../../src/chain/blocks/validate";
import {BlockRepository} from "../../../../src/db/api/beacon/repositories";
import {getBlockSummary} from "../../../utils/headBlockInfo";
import {silentLogger} from "../../../utils/logger";

describe("block validate stream", function () {
  const logger = silentLogger;
  let blockDbStub: SinonStubbedInstance<BlockRepository>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

  beforeEach(function () {
    blockDbStub = sinon.createStubInstance(BlockRepository);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
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
    forkChoiceStub.getFinalizedCheckpoint.returns({epoch: 1, root: Buffer.alloc(0)});
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
    forkChoiceStub.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(0)});
    forkChoiceStub.getHead.returns(getBlockSummary({blockRoot: Buffer.alloc(32, 0), slot: 0}));
    blockDbStub.get.resolves(config.types.SignedBeaconBlock.defaultValue());
    const result = await pipe(
      [{signedBlock: receivedBlock, trusted: false}],
      validateBlock(config, logger, forkChoiceStub, eventBusStub),
      all
    );
    expect(result).to.have.length(1);
  });
});
