import chai, {expect} from "chai";
import chaiAsPromised from 'chai-as-promised';
import sinon from "sinon";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconDb} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {BlockRepository, ChainRepository, StateRepository} from "../../../../src/db/api/beacon/repositories";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";

chai.use(chaiAsPromised);

describe('beacon db api', function() {

  const sandbox = sinon.createSandbox();

  let db, controller;

  beforeEach(function () {
    controller = sandbox.createStubInstance<LevelDbController>(LevelDbController);
    db = new BeaconDb({controller, config});
    db.block = sandbox.createStubInstance(BlockRepository);
    db.state = sandbox.createStubInstance(StateRepository);
    db.chain = sandbox.createStubInstance(ChainRepository);
  });

  it('should not set chain head roots - invalid block root', async function () {
    const blockRoot = Buffer.alloc(32, 0);
    const stateRoot = Buffer.alloc(32, 1);
    db.block.get.resolves(null);
    db.state.get.resolves("notNull");
    await expect(db.setChainHeadRoots(blockRoot, stateRoot)).to.be.rejectedWith("unknown block root");
    expect(db.block.get.withArgs(blockRoot).calledOnce).to.be.true;
    expect(db.state.get.withArgs(stateRoot).calledOnce).to.be.true;
  });

  it('should not set chain head roots - invalid state root', async function () {
    const blockRoot = Buffer.alloc(32, 0);
    const stateRoot = Buffer.alloc(32, 1);
    db.block.get.resolves("notNull");
    db.state.get.resolves(null);
    await expect(db.setChainHeadRoots(blockRoot, stateRoot)).to.be.rejectedWith("unknown state root");
    expect(db.block.get.withArgs(blockRoot).calledOnce).to.be.true;
    expect(db.state.get.withArgs(stateRoot).calledOnce).to.be.true;
  });

  it('should set chain head roots', async function () {
    const blockRoot = Buffer.alloc(32, 0);
    const stateRoot = Buffer.alloc(32, 1);
    db.block.get.resolves(generateEmptyBlock());
    db.state.get.resolves(generateState());
    await expect(db.setChainHeadRoots(blockRoot, stateRoot)).to.not.be.rejected;
    expect(db.block.get.withArgs(blockRoot).calledOnce).to.be.true;
    expect(db.state.get.withArgs(stateRoot).calledOnce).to.be.true;
    expect(db.chain.setLatestStateRoot.calledOnce).to.be.true;
    expect(controller.batchPut.calledOnce).to.be.true;
  });

  it('should set chain head roots - given state and block', async function () {
    const blockRoot = Buffer.alloc(32, 0);
    const stateRoot = Buffer.alloc(32, 1);
    await expect(db.setChainHeadRoots(blockRoot, stateRoot, generateEmptyBlock(), generateState())).to.not.be.rejected;
    expect(db.block.get.notCalled).to.be.true;
    expect(db.state.get.notCalled).to.be.true;
    expect(db.chain.setLatestStateRoot.calledOnce).to.be.true;
    expect(controller.batchPut.calledOnce).to.be.true;
  });

  it('should get validator index', async function () {
    const state = generateState({validators: [generateValidator()]});
    db.state.getLatest.resolves(state);
    const index = await db.getValidatorIndex(state.validators[0].pubkey);
    expect(index).to.be.equal(0);
    expect(db.state.getLatest.calledOnce).to.be.true;
  });

  it('should get validator index- not found', async function () {
    const state = generateState({validators: [generateValidator()]});
    db.state.getLatest.resolves(state);
    const index = await db.getValidatorIndex(Buffer.alloc(48, 123));
    expect(index).to.be.equal(-1);
    expect(db.state.getLatest.calledOnce).to.be.true;
  });

});
