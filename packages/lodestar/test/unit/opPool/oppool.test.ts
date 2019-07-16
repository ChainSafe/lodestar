import sinon from "sinon";
import {expect} from "chai";
import {OpPool} from "../../../src/opPool";
import {BeaconDB} from "../../../src/db";
import {BeaconChain} from "../../../src/chain";
import {generateDeposit} from "../../utils/deposit";
import {generateEmptyBlock} from "../../utils/block";


describe("operation pool", function () {
  let sandbox = sinon.createSandbox();
  let opPool: OpPool;
  let chainStub, dbStub;

  beforeEach(()=>{
    dbStub = sandbox.createStubInstance(BeaconDB);
    chainStub = sandbox.createStubInstance(BeaconChain);
    opPool = new OpPool({}, {
      db: dbStub,
      chain: chainStub
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
    await opPool.removeOperations(block);
    expect(dbStub.deleteDeposits.calledOnce).to.be.true;
    expect(dbStub.deleteVoluntaryExits.calledOnce).to.be.true;
    expect(dbStub.deleteProposerSlashings.calledOnce).to.be.true;
    expect(dbStub.deleteAttesterSlashings.calledOnce).to.be.true;
  });


});
