import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconDb} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {BlockRepository, StateArchiveRepository} from "../../../../src/db/api/beacon/repositories";
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
    db = new BeaconDb({controller, config}) as  StubbedBeaconDb;
    db.block = sandbox.createStubInstance(BlockRepository) as any;
    db.stateArchive = sandbox.createStubInstance(StateArchiveRepository) as any;
  });

  it("should get validator index", async function () {
    const state = generateState({validators: [generateValidator()]});
    db.stateArchive.lastValue.resolves(state as any);
    const index = await db.getValidatorIndex(state.validators[0].pubkey);
    expect(index).to.be.equal(0);
    expect(db.stateArchive.lastValue.calledOnce).to.be.true;
  });

  it("should get validator index- not found", async function () {
    const state = generateState({validators: [generateValidator()]});
    db.stateArchive.lastValue.resolves(state as any);
    const index = await db.getValidatorIndex(Buffer.alloc(48, 123));
    expect(index).to.be.equal(-1);
    expect(db.stateArchive.lastValue.calledOnce).to.be.true;
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
    dbStub.stateArchive = sandbox.createStubInstance(StateArchiveRepository) as any;

    // Add to state
    dbStub.stateArchive.lastValue.resolves(generateState(
      {
        validators: generateValidators(100, {activationEpoch: 0, effectiveBalance: 2n ** 5n * BigInt(1e9)})
      }
    ) as any);
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

