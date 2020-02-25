import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconDb} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {BlockRepository, ChainRepository, StateRepository} from "../../../../src/db/api/beacon/repositories";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";
import {beforeEach, describe, it} from "mocha";

chai.use(chaiAsPromised);

describe("beacon db api", function() {

  const sandbox = sinon.createSandbox();

  let db: any, controller: any;

  beforeEach(function () {
    controller = sandbox.createStubInstance<LevelDbController>(LevelDbController);
    db = new BeaconDb({controller, config});
    db.block = sandbox.createStubInstance(BlockRepository);
    db.state = sandbox.createStubInstance(StateRepository);
    db.chain = sandbox.createStubInstance(ChainRepository);
  });

  it("should store chain head and update refs", async function () {
    const block = generateEmptySignedBlock();
    const state = generateState();
    await db.storeChainHead(block, state);
    expect(db.block.add.withArgs(block).calledOnce).to.be.true;
    expect(db.state.set.withArgs(block.message.stateRoot, state).calledOnce).to.be.true;
    expect(db.chain.setLatestStateRoot.withArgs(block.message.stateRoot).calledOnce).to.be.true;
    expect(db.chain.setChainHeadSlot.withArgs(block.message.slot).calledOnce).to.be.true;
  });

  it("should not update chain head - missing block", async function () {
    db.block.get.resolves(null);
    await expect(
      db.updateChainHead(Buffer.alloc(32), Buffer.alloc(32))
    ).to.be.eventually.rejectedWith("unknown block root");
  });

  it("should not update chain head - missing state", async function () {
    db.block.get.resolves(generateEmptySignedBlock());
    db.state.get.resolves(null);
    await expect(
      db.updateChainHead(Buffer.alloc(32), Buffer.alloc(32))
    ).to.be.eventually.rejectedWith("unknown state root");
  });

  it("should update chain head", async function () {
    db.block.get.resolves(generateEmptySignedBlock());
    db.state.get.resolves(generateState());
    await db.updateChainHead(Buffer.alloc(32), Buffer.alloc(32));
    expect(db.chain.setLatestStateRoot.calledOnce).to.be.true;
    expect(db.chain.setChainHeadSlot.calledOnce).to.be.true;
  });

  it("should get validator index", async function () {
    const state = generateState({validators: [generateValidator()]});
    db.state.getLatest.resolves(state);
    const index = await db.getValidatorIndex(state.validators[0].pubkey);
    expect(index).to.be.equal(0);
    expect(db.state.getLatest.calledOnce).to.be.true;
  });

  it("should get validator index- not found", async function () {
    const state = generateState({validators: [generateValidator()]});
    db.state.getLatest.resolves(state);
    const index = await db.getValidatorIndex(Buffer.alloc(48, 123));
    expect(index).to.be.equal(-1);
    expect(db.state.getLatest.calledOnce).to.be.true;
  });

});
