import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/default";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {BeaconDb} from "../../../../src/db";
import {generateEmptySignedBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";
import {
  AttesterSlashingRepository,
  DepositEventRepository,
  ProposerSlashingRepository,
  VoluntaryExitRepository,
  StateArchiveRepository,
} from "../../../../src/db/repositories";
import {generateValidators} from "../../../utils/validator";
import {createStubInstance} from "../../../utils/types";

chai.use(chaiAsPromised);

describe("beacon db - post block processing", function () {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb;

  beforeEach(() => {
    dbStub = new BeaconDb({
      config,
      controller: sandbox.createStubInstance(LevelDbController),
    }) as StubbedBeaconDb;
    dbStub.depositEvent = createStubInstance(DepositEventRepository);
    dbStub.voluntaryExit = createStubInstance(VoluntaryExitRepository);
    dbStub.proposerSlashing = createStubInstance(ProposerSlashingRepository);
    dbStub.attesterSlashing = createStubInstance(AttesterSlashingRepository);
    dbStub.stateArchive = createStubInstance(StateArchiveRepository);

    // Add to state
    dbStub.stateArchive.lastValue.resolves(
      generateState({
        validators: generateValidators(100, {
          activationEpoch: 0,
          effectiveBalance: BigInt(2) ** BigInt(5) * BigInt(1e9),
        }),
      }) as any
    );
  });

  it("should do cleanup after block processing", async function () {
    const block = generateEmptySignedBlock();
    dbStub.depositEvent.deleteOld.resolves();
    dbStub.voluntaryExit.batchRemove.resolves();
    dbStub.proposerSlashing.batchRemove.resolves();
    dbStub.attesterSlashing.batchRemove.resolves();
    // aggregateAndProof opPool is not a repository anymore

    await dbStub.processBlockOperations(block);
    expect(dbStub.depositEvent.deleteOld.calledOnce).to.be.true;
    expect(dbStub.voluntaryExit.batchRemove.calledOnce).to.be.true;
    expect(dbStub.proposerSlashing.batchRemove.calledOnce).to.be.true;
    expect(dbStub.attesterSlashing.batchRemove.calledOnce).to.be.true;
  });
});
