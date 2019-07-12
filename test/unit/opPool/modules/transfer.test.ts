import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {expect} from "chai";
import {TransferOperations} from "../../../../src/opPool/modules/transfer";
import {generateEmptyTransfer} from "../../../utils/transfer";

describe("opPool - transfers", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: TransferOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new TransferOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateEmptyTransfer();

    dbStub.setTransfer.resolves();
    await service.receive(data);
    expect(dbStub.setTransfer.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateEmptyTransfer()];

    dbStub.getTransfers.resolves(data);
    let result = await service.all();
    expect(dbStub.getTransfers.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    const data = generateEmptyTransfer();
    dbStub.deleteTransfers.resolves();
    await service.remove([data]);
    expect(dbStub.deleteTransfers.withArgs([data]).calledOnce).to.be.true;
  });

});
