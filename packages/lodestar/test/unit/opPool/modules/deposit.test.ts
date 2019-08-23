import sinon from "sinon";
import {expect} from "chai";
import {DepositsOperations} from "../../../../src/opPool/modules";
import {generateDeposit} from "../../../utils/deposit";
import {DepositRepository} from "../../../../src/db/api/beacon/repositories";

describe("opPool - deposits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service;

  beforeEach(function () {
    dbStub = {
      deposit: sandbox.createStubInstance(DepositRepository)
    };
    service = new DepositsOperations(dbStub.deposit);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateDeposit();

    dbStub.deposit.set.resolves();
    await service.receive(0, data);
    expect(dbStub.deposit.set.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateDeposit()];

    dbStub.deposit.getAll.resolves(data);
    let result = await service.getAll();
    expect(dbStub.deposit.getAll.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    dbStub.deposit.deleteOld.resolves();
    await service.removeOld(3);
    expect(dbStub.deposit.deleteOld.withArgs(3).calledOnce).to.be.true;
  });

});
