import sinon from "sinon";
import {expect} from "chai";
import {OpPool} from "../../../src/opPool";
import {BeaconDB} from "../../../src/db";
import {generateEmptyBlock} from "../../utils/block";
import {EthersEth1Notifier} from "../../../src/eth1";


describe("operation pool", function () {
  let sandbox = sinon.createSandbox();
  let opPool: OpPool;
  let eth1Stub, dbStub;

  beforeEach(()=>{
    dbStub = sandbox.createStubInstance(BeaconDB);
    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
    opPool = new OpPool({}, {
      db: dbStub,
      eth1: eth1Stub
    });
  });

  //receive
  it('should start and stop operation pool ', async function () {
    try {
      await opPool.start();
      await opPool.stop();
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should do cleanup after block processing', async function () {
    const block  = generateEmptyBlock();
    dbStub.deleteDeposits.resolves();
    dbStub.deleteVoluntaryExits.resolves();
    dbStub.deleteProposerSlashings.resolves();
    dbStub.deleteAttesterSlashings.resolves();
    await opPool.processBlockOperations(block);
    expect(dbStub.deleteDeposits.calledOnce).to.be.true;
    expect(dbStub.deleteVoluntaryExits.calledOnce).to.be.true;
    expect(dbStub.deleteProposerSlashings.calledOnce).to.be.true;
    expect(dbStub.deleteAttesterSlashings.calledOnce).to.be.true;
  });


});
