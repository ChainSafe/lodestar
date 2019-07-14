import {BeaconDB} from "../../../../src/db";
import sinon from "sinon";
import {AttestationOperations} from "../../../../src/opPool/modules";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {expect} from "chai";

describe("opPool - attestations", function () {

  const sandbox = sinon.createSandbox();

  let dbStub, service: AttestationOperations;

  beforeEach(function () {
    dbStub = sandbox.createStubInstance(BeaconDB);
    service = new AttestationOperations(dbStub);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('should receive attestation', async function () {
    const attestation = {
      ...generateEmptyAttestation(),
    };

    dbStub.setAttestation.resolves(null);
    await service.receive(attestation);
    expect(dbStub.setAttestation.calledOnce).to.be.true;
  });


  it('should return  attestations', async function () {
    const attestation = {
      ...generateEmptyAttestation(),
    };

    dbStub.getAttestations.resolves(attestation);
    let result = await service.getAll();
    expect(dbStub.getAttestations.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(attestation);
  });

  it.skip('should remove  attestations', async function () {
    const attestations = [
      generateEmptyAttestation()
    ];
    dbStub.deleteAttestations.resolves();
    await service.remove(0);
    expect(dbStub.deleteAttestations.withArgs(attestations).calledOnce).to.be.true;
  });

});
