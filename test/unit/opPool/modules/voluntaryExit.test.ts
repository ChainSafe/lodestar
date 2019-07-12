import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {expect} from "chai";
import {VoluntaryExitOperations} from "../../../../src/opPool/modules/voluntaryExit";
import {generateEmptyVoluntaryExit} from "../../../utils/voluntaryExits";

describe("opPool - voluntaryExits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: VoluntaryExitOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new VoluntaryExitOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateEmptyVoluntaryExit();

    dbStub.setVoluntaryExit.resolves();
    await service.receive(data);
    expect(dbStub.setVoluntaryExit.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateEmptyVoluntaryExit()];

    dbStub.getVoluntaryExits.resolves(data);
    let result = await service.all();
    expect(dbStub.getVoluntaryExits.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    const data = generateEmptyVoluntaryExit();
    dbStub.deleteVoluntaryExits.resolves();
    await service.remove([data]);
    expect(dbStub.deleteVoluntaryExits.withArgs([data]).calledOnce).to.be.true;
  });

});
