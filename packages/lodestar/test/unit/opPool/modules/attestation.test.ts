import sinon from "sinon";
import {expect} from "chai";
import {AttestationOperations} from "../../../../src/opPool/modules";
import {AttestationRepository} from "../../../../src/db/api/beacon/repositories";
import {afterEach, beforeEach, describe, it} from "mocha";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import * as attestationUtils from "../../../../src/chain/stateTransition/util";
import * as blockOperations from "../../../../src/chain/stateTransition/block/operations";
import {generateState} from "../../../utils/state";

describe("opPool - deposits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: any, service: any, aggregateAttestationStub: any, processAttestationStub: any;

  beforeEach(function () {
    dbStub = {
      attestation: sandbox.createStubInstance(AttestationRepository)
    };
    service = new AttestationOperations(dbStub.attestation, {config});
    aggregateAttestationStub = sandbox.stub(attestationUtils, "aggregateAttestation");
    processAttestationStub = sandbox.stub(blockOperations, "processAttestation");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should receive without aggregation", async function () {
    const data = generateEmptyAttestation();

    dbStub.attestation.get.resolves(null);
    dbStub.attestation.set.resolves();
    await service.receive(data);
    expect(dbStub.attestation.get.calledOnce).to.be.true;
    expect(aggregateAttestationStub.called).to.be.false;
    expect(dbStub.attestation.setUnderRoot.calledOnce).to.be.true;
  });

  it("should receive and aggregate", async function () {
    const data = generateEmptyAttestation();

    dbStub.attestation.get.resolves(data);
    dbStub.attestation.set.resolves();
    await service.receive(data);
    expect(dbStub.attestation.get.calledOnce).to.be.true;
    expect(aggregateAttestationStub.calledOnce).to.be.true;
    expect(dbStub.attestation.setUnderRoot.calledOnce).to.be.true;
  });

  it("should get valid attestations", async function () {
    const data = generateEmptyAttestation();
    dbStub.attestation.getAll.resolves([data, data]);
    processAttestationStub.onFirstCall().throws().onSecondCall().returns(null);
    const result = await service.getValid(generateState({}, config));
    expect(result.length).to.be.equal(1);
  });

});
