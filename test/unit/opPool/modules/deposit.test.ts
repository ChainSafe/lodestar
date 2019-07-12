import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {expect} from "chai";
import {DepositsOperations} from "../../../../src/opPool/modules/deposit";
import {generateDeposit} from "../../../utils/deposit";

describe("opPool - deposits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: DepositsOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new DepositsOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateDeposit();

    dbStub.setDeposit.resolves();
    await service.receive(0, data);
    expect(dbStub.setDeposit.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateDeposit()];

    dbStub.getDeposits.resolves(data);
    let result = await service.all();
    expect(dbStub.getDeposits.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    dbStub.deleteDeposits.resolves();
    await service.removeOld(3);
    expect(dbStub.deleteDeposits.withArgs(3).calledOnce).to.be.true;
  });

});
