import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {expect} from "chai";
import {ProposerSlashingOperations} from "../../../../src/opPool/modules/proposerSlashing";
import {generateEmptyProposerSlashing} from "../../../utils/slashings";

describe("opPool - proposerSlashings", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: ProposerSlashingOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new ProposerSlashingOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive', async function () {
    const data = generateEmptyProposerSlashing();

    dbStub.setProposerSlashing.resolves();
    await service.receive(data);
    expect(dbStub.setProposerSlashing.calledOnce).to.be.true;
  });


  it('should return all', async function () {
    const data = [generateEmptyProposerSlashing()];

    dbStub.getProposerSlashings.resolves(data);
    let result = await service.all();
    expect(dbStub.getProposerSlashings.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(data);
  });

  it('should remove', async function () {
    const data = generateEmptyProposerSlashing();
    dbStub.deleteProposerSlashings.resolves();
    await service.remove([data]);
    expect(dbStub.deleteProposerSlashings.withArgs([data]).calledOnce).to.be.true;
  });

});
