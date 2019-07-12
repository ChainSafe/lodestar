import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {expect} from "chai";
import {generateEmptyAttesterSlashing} from "../../../utils/slashings";
import {AttesterSlashingOperations} from "../../../../src/opPool/modules/attesterSlashing";

describe("opPool - AttesterSlashings", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: AttesterSlashingOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new AttesterSlashingOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateEmptyAttesterSlashing();

    dbStub.setAttesterSlashing.resolves();
    await service.receive(data);
    expect(dbStub.setAttesterSlashing.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateEmptyAttesterSlashing()];

    dbStub.getAttesterSlashings.resolves(data);
    let result = await service.all();
    expect(dbStub.getAttesterSlashings.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    const data = generateEmptyAttesterSlashing();
    dbStub.deleteAttesterSlashings.resolves();
    await service.remove([data]);
    expect(dbStub.deleteAttesterSlashings.withArgs([data]).calledOnce).to.be.true;
  });

});
