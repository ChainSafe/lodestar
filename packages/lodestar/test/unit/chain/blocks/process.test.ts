import {expect} from "chai";
import all from "it-all";
import pipe from "it-pipe";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";

import {ChainEventEmitter, IBlockJob} from "../../../../src/chain";
import {IBeaconClock, LocalClock} from "../../../../src/chain/clock";
import {BlockPool} from "../../../../src/chain/blocks/pool";
import {processBlock} from "../../../../src/chain/blocks/process";
import {StateRegenerator} from "../../../../src/chain/regen";
import {generateState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";
import {silentLogger} from "../../../utils/logger";
import {generateBlockSummary} from "../../../utils/block";

describe("block process stream", function () {
  const logger = silentLogger;
  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let clockStub: SinonStubbedInstance<IBeaconClock>;
  let regenStub: SinonStubbedInstance<StateRegenerator>;
  let blockPoolStub: SinonStubbedInstance<BlockPool>;
  let stateTransitionStub: SinonStub;
  let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
    blockPoolStub = sinon.createStubInstance(BlockPool);
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    clockStub = sinon.createStubInstance(LocalClock);
    sinon.stub(clockStub, "currentSlot").get(() => 0);
    regenStub = sinon.createStubInstance(StateRegenerator);
    stateTransitionStub = sandbox.stub(stateTransitionUtils, "fastStateTransition");
    eventBusStub = sinon.createStubInstance(ChainEventEmitter);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("missing parent block", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    dbStub.block.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(null);
    regenStub.getPreState.throws();
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(0);
    expect(blockPoolStub.addPendingBlock.calledOnce).to.be.true;
  });

  it("future slot", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    receivedJob.signedBlock.message.slot = 1;
    const parentBlock = config.types.SignedBeaconBlock.defaultValue();
    dbStub.block.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(0);
    expect(blockPoolStub.addPendingSlotBlock.calledOnce).to.be.true;
  });

  it("missing parent state", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    const parentBlock = config.types.SignedBeaconBlock.defaultValue();
    dbStub.block.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    dbStub.stateCache.get.resolves(null);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(0);
  });

  it("failed state transition", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    const parentBlock = config.types.SignedBeaconBlock.defaultValue();
    forkChoiceStub.getBlock
      .withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array)
      .resolves(parentBlock);
    dbStub.stateCache.get.resolves({state: generateState(), epochCtx: new EpochContext(config)});
    stateTransitionStub.throws();
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(0);
    expect(eventBusStub.emit.calledWith("error:block" as any)).to.be.true;
  });

  it("successful block process - not new chain head", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    forkChoiceStub.getBlock.returns(generateBlockSummary());
    forkChoiceStub.getHead.returns(generateBlockSummary());
    regenStub.getPreState.resolves({state: generateState(), epochCtx: new EpochContext(config)});
    stateTransitionStub.returns({state: generateState(), epochCtx: new EpochContext(config)});
    forkChoiceStub.getHeadRoot.returns(Buffer.alloc(32, 1));
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(1);
    expect(dbStub.block.put.calledOnce).to.be.true;
    expect(dbStub.stateCache.add.calledOnce).to.be.true;
    expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
  });

  it("successful block process - new chain head", async function () {
    const receivedJob: IBlockJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false,
      reprocess: false,
    };
    forkChoiceStub.getBlock.returns(generateBlockSummary());
    forkChoiceStub.getHead.returns(generateBlockSummary());
    regenStub.getPreState.resolves({state: generateState(), epochCtx: new EpochContext(config)});
    stateTransitionStub.returns({state: generateState(), epochCtx: new EpochContext(config)});
    forkChoiceStub.getHeadRoot.returns(Buffer.alloc(32, 2));
    dbStub.eth1Data.values.resolves([]);
    dbStub.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    dbStub.block.get.resolves(receivedJob.signedBlock);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        logger,
        dbStub,
        forkChoiceStub,
        regenStub,
        (blockPoolStub as unknown) as BlockPool,
        eventBusStub,
        clockStub
      ),
      all
    );
    expect(result).to.have.length(1);
    expect(dbStub.block.put.calledOnce).to.be.true;
    expect(dbStub.stateCache.add.calledOnce).to.be.true;
    expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
  });
});
