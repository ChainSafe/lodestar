import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconDb} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {StateArchiveRepository} from "../../../../src/db/api/beacon/repositories";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
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

