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
import {StubbedBeaconDb} from "../../../utils/stub";
import {
  AttesterSlashingRepository,
  DepositDataRepository,
  ProposerSlashingRepository,
  VoluntaryExitRepository,
  AttestationRepository,
  AggregateAndProofRepository
} from "../../../../src/db/api/beacon/repositories";
import {generateValidators} from "../../../utils/validator";


chai.use(chaiAsPromised);

describe("beacon db api", function() {

  const sandbox = sinon.createSandbox();

  let db: StubbedBeaconDb, controller: any;

  beforeEach(function () {
    controller = sandbox.createStubInstance<LevelDbController>(LevelDbController);
    db = new BeaconDb({controller, config}) as unknown as StubbedBeaconDb;
    db.block = sandbox.createStubInstance(BlockRepository) as any;
    db.state = sandbox.createStubInstance(StateRepository) as any;
    db.chain = sandbox.createStubInstance(ChainRepository) as any;
  });

  it("should store chain head and update refs", async function () {
    const block = generateEmptySignedBlock();
    const state = generateState();
    await db.storeChainHead(block, state);
    expect(db.block.add.withArgs(block).calledOnce).to.be.true;
    expect(db.state.put.withArgs(block.message.stateRoot as Uint8Array, state).calledOnce).to.be.true;
    expect(db.chain.setLatestStateRoot.withArgs(block.message.stateRoot as Uint8Array).calledOnce).to.be.true;
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

describe("beacon db - post block processing", function () {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb;

  beforeEach(()=>{
    dbStub = new BeaconDb({config, controller: sandbox.createStubInstance(LevelDbController)}) as unknown as StubbedBeaconDb;
    dbStub.depositData = sandbox.createStubInstance(DepositDataRepository) as any;
    dbStub.voluntaryExit = sandbox.createStubInstance(VoluntaryExitRepository) as any;
    dbStub.proposerSlashing = sandbox.createStubInstance(ProposerSlashingRepository) as any;
    dbStub.attesterSlashing = sandbox.createStubInstance(AttesterSlashingRepository) as any;
    dbStub.attestation = sandbox.createStubInstance(AttestationRepository) as any;
    dbStub.aggregateAndProof = sandbox.createStubInstance(AggregateAndProofRepository) as any;
    dbStub.state = sandbox.createStubInstance(StateRepository) as any;

    // Add to state
    dbStub.state.getLatest.resolves(generateState(
      {
        validators: generateValidators(100, {activationEpoch: 0, effectiveBalance: 2n ** 5n * BigInt(1e9)})
      }
    ));
  });

  it("should do cleanup after block processing", async function () {
    const block  = generateEmptySignedBlock();
    dbStub.depositData.deleteOld.resolves();
    dbStub.voluntaryExit.batchRemove.resolves();
    dbStub.proposerSlashing.batchRemove.resolves();
    dbStub.attesterSlashing.batchRemove.resolves();
    dbStub.aggregateAndProof.batchRemove.resolves();
    dbStub.aggregateAndProof.values.resolves([]);
    await dbStub.processBlockOperations(block);
    expect(dbStub.depositData.deleteOld.calledOnce).to.be.true;
    expect(dbStub.voluntaryExit.batchRemove.calledOnce).to.be.true;
    expect(dbStub.proposerSlashing.batchRemove.calledOnce).to.be.true;
    expect(dbStub.attesterSlashing.batchRemove.calledOnce).to.be.true;
  });

});

