import sinon from "sinon";
import {describe} from "mocha";
import {expect} from "chai";
import {OpPool} from "../../../src/opPool";
import {generateEmptySignedBlock} from "../../utils/block";
import {EthersEth1Notifier} from "../../../src/eth1";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {
  AttesterSlashingRepository,
  DepositDataRepository,
  ProposerSlashingRepository,
  VoluntaryExitRepository, AttestationRepository,
  StateRepository, AggregateAndProofRepository
} from "../../../src/db/api/beacon/repositories";
import {generateState} from "../../utils/state";
import {generateValidators} from "../../utils/validator";

describe("operation pool", function () {
  const sandbox = sinon.createSandbox();
  let opPool: OpPool;
  let eth1Stub: any, dbStub: any;

  beforeEach(()=>{
    dbStub = {
      depositData: sandbox.createStubInstance(DepositDataRepository),
      voluntaryExit: sandbox.createStubInstance(VoluntaryExitRepository),
      proposerSlashing: sandbox.createStubInstance(ProposerSlashingRepository),
      attesterSlashing: sandbox.createStubInstance(AttesterSlashingRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      aggregateAndProof: sandbox.createStubInstance(AggregateAndProofRepository),
      state: sandbox.createStubInstance(StateRepository)
    };

    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);

    // Add to state
    dbStub.state.getLatest.resolves(generateState(
      {
        validators: generateValidators(100, {activation: 0, balance: 2n ** 5n * BigInt(1e9)})
      }
    ));

    opPool = new OpPool({}, {
      config: config,
      db: dbStub,
      eth1: eth1Stub
    });
  });

  //receive
  it("should start and stop operation pool ", async function () {
    try {
      await opPool.start();
      await opPool.stop();
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should do cleanup after block processing", async function () {
    const block  = generateEmptySignedBlock();
    dbStub.depositData.deleteOld.resolves();
    dbStub.voluntaryExit.deleteManyByValue.resolves();
    dbStub.proposerSlashing.deleteManyByValue.resolves();
    dbStub.attesterSlashing.deleteManyByValue.resolves();
    dbStub.aggregateAndProof.deleteManyByValue.resolves();
    dbStub.aggregateAndProof.getAll.resolves([]);
    await opPool.processBlockOperations(block);
    expect(dbStub.depositData.deleteOld.calledOnce).to.be.true;
    expect(dbStub.voluntaryExit.deleteManyByValue.calledOnce).to.be.true;
    expect(dbStub.proposerSlashing.deleteManyByValue.calledOnce).to.be.true;
    expect(dbStub.attesterSlashing.deleteManyByValue.calledOnce).to.be.true;
  });


});
