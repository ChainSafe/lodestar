import pipe from "it-pipe";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ILMDGHOST, StatefulDagLMDGHOST} from "../../../../src/chain/forkChoice";
import {collect} from "./utils";
import {expect} from "chai";
import {BeaconChain, ChainEventEmitter, IBlockProcessJob} from "../../../../src/chain";
import {BlockPool} from "../../../../src/chain/blocks/pool";
import {processBlock} from "../../../../src/chain/blocks/process";
import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition";
import {generateState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";

describe("block process stream", function () {

  let dbStub: StubbedBeaconDb;
  let forkChoiceStub: SinonStubbedInstance<ILMDGHOST>;
  let blockPoolStub: SinonStubbedInstance<BlockPool>;
  let stateTransitionStub: SinonStub;
  let eventBusStub: SinonStubbedInstance<ChainEventEmitter>;

  const sandbox = sinon.createSandbox();

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sandbox);
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
    dbStub.block.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(null);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        forkChoiceStub,
        blockPoolStub as unknown as BlockPool,
        eventBusStub
      ),
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
    dbStub.block.get.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    dbStub.stateCache.get.resolves(null);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        forkChoiceStub,
        blockPoolStub as unknown as BlockPool, eventBusStub
      ),
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
    forkChoiceStub.getBlockSummaryByBlockRoot.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    dbStub.stateCache.get.resolves(generateState() as any);
    stateTransitionStub.throws();
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        forkChoiceStub, blockPoolStub as unknown as BlockPool, eventBusStub
      ),
      collect
    );
    expect(result).to.have.length(0);
    expect(dbStub.badBlock.put.calledOnce).to.be.true;
  });

  it("successful block process - not new chain head", async function () {
    const receivedJob: IBlockProcessJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false
    };
    const parentBlock = config.types.SignedBeaconBlock.defaultValue();
    forkChoiceStub.getBlockSummaryByBlockRoot.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    dbStub.stateCache.get.resolves(generateState() as any);
    stateTransitionStub.resolves(generateState());
    //dbStub.chain.getChainHeadRoot.resolves(Buffer.alloc(32, 1));
    forkChoiceStub.headBlockRoot.returns(
      Buffer.alloc(32,1)
    );
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        forkChoiceStub, blockPoolStub as unknown as BlockPool,
        eventBusStub
      ),
      collect
    );
    expect(result).to.have.length(1);
    expect(dbStub.badBlock.put.notCalled).to.be.true;
    expect(dbStub.block.put.calledOnce).to.be.true;
    expect(dbStub.stateCache.add.calledOnce).to.be.true;
    expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
  });

  it("successful block process - new chain head", async function () {
    const receivedJob: IBlockProcessJob = {
      signedBlock: config.types.SignedBeaconBlock.defaultValue(),
      trusted: false
    };
    const parentBlock = config.types.SignedBeaconBlock.defaultValue();
    forkChoiceStub.getBlockSummaryByBlockRoot.withArgs(receivedJob.signedBlock.message.parentRoot.valueOf() as Uint8Array).resolves(parentBlock);
    dbStub.stateCache.get.resolves(generateState() as any);
    stateTransitionStub.resolves(generateState());
    //dbStub.chain.getChainHeadRoot.resolves(Buffer.alloc(32, 1));
    forkChoiceStub.headBlockRoot.returns(Buffer.alloc(32, 2));
    dbStub.depositData.values.resolves([]);
    dbStub.depositDataRoot.getTreeBacked.resolves(config.types.DepositDataRootList.tree.defaultValue());
    dbStub.block.get.resolves(receivedJob.signedBlock);
    const result = await pipe(
      [receivedJob],
      processBlock(
        config,
        sinon.createStubInstance(WinstonLogger),
        dbStub,
        forkChoiceStub, blockPoolStub as unknown as BlockPool,
        eventBusStub
      ),
      collect
    );
    expect(result).to.have.length(1);
    expect(dbStub.badBlock.put.notCalled).to.be.true;
    expect(dbStub.block.put.calledOnce).to.be.true;
    expect(dbStub.stateCache.add.calledOnce).to.be.true;
    expect(blockPoolStub.onProcessedBlock.calledOnce).to.be.true;
  });
});
