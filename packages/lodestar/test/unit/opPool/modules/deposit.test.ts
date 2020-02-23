import sinon, { SinonStubbedInstance } from "sinon";
import {expect} from "chai";
import {DepositDataOperations} from "../../../../src/opPool/modules";
import {generateDepositData} from "../../../utils/deposit";
import {DepositDataRepository} from "../../../../src/db/api/beacon/repositories";

describe("opPool - deposits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: {
    depositData: SinonStubbedInstance<DepositDataRepository>;
  };

  let service: DepositDataOperations;

  beforeEach(function () {
    dbStub = {
      depositData: sandbox.createStubInstance(DepositDataRepository)
    };
    service = new DepositDataOperations(dbStub.depositData as unknown as DepositDataRepository);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateDepositData();

    dbStub.depositData.set.resolves();
    await service.receive(0, data);
    expect(dbStub.depositData.set.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateDepositData()];

    dbStub.depositData.getAll.resolves(data);
    let result = await service.getAll();
    expect(dbStub.depositData.getAll.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should return range', async function () {
    dbStub.depositData.getAllBetween.resolves([]);
    await service.getAllBetween(0, 1);
    expect(dbStub.depositData.getAllBetween.calledOnce).to.be.true;
  });

  it('should remove', async function () {
    dbStub.depositData.deleteOld.resolves();
    await service.removeOld(3);
    expect(dbStub.depositData.deleteOld.withArgs(3).calledOnce).to.be.true;
  });

});
