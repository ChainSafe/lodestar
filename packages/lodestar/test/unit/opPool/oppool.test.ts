import sinon from "sinon";
import {describe} from "mocha";
import {expect} from "chai";
import {OpPool} from "../../../src/opPool";
import {generateEmptySignedBlock} from "../../utils/block";
import {EthersEth1Notifier} from "../../../src/eth1";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {
  AttesterSlashingRepository,
  DepositDataRepository,
  ProposerSlashingRepository,
  VoluntaryExitRepository, AttestationRepository,
  StateRepository, AggregateAndProofRepository
} from "../../../src/db/api/beacon/repositories";
import {generateState} from "../../utils/state";
import {generateValidators} from "../../utils/validator";
import { StubbedBeaconDb } from "../../utils/stub";

describe("operation pool", function () {
  const sandbox = sinon.createSandbox();
  let opPool: OpPool;
  let eth1Stub: any, dbStub: StubbedBeaconDb;

  beforeEach(()=>{
    dbStub = {
      depositData: sandbox.createStubInstance(DepositDataRepository),
      voluntaryExit: sandbox.createStubInstance(VoluntaryExitRepository),
      proposerSlashing: sandbox.createStubInstance(ProposerSlashingRepository),
      attesterSlashing: sandbox.createStubInstance(AttesterSlashingRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      aggregateAndProof: sandbox.createStubInstance(AggregateAndProofRepository),
      state: sandbox.createStubInstance(StateRepository)
    } as StubbedBeaconDb;

    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);

    // Add to state
    dbStub.state.getLatest.resolves(generateState(
      {
        validators: generateValidators(100, {activationEpoch: 0, effectiveBalance: 2n ** 5n * BigInt(1e9)})
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
    dbStub.voluntaryExit.batchRemove.resolves();
    dbStub.proposerSlashing.batchRemove.resolves();
    dbStub.attesterSlashing.batchRemove.resolves();
    dbStub.aggregateAndProof.batchRemove.resolves();
    dbStub.aggregateAndProof.values.resolves([]);
    await opPool.processBlockOperations(block);
    expect(dbStub.depositData.deleteOld.calledOnce).to.be.true;
    expect(dbStub.voluntaryExit.batchRemove.calledOnce).to.be.true;
    expect(dbStub.proposerSlashing.batchRemove.calledOnce).to.be.true;
    expect(dbStub.attesterSlashing.batchRemove.calledOnce).to.be.true;
  });


});
