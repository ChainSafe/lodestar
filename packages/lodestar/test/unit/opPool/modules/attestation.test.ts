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
import {AttestationDataRepository} from "../../../../src/db/api/beacon/repositories/attestationsData";

describe("opPool - deposits", function () {

  const sandbox = sinon.createSandbox();

  let dbStub: any, service: any, canAggregateStub: any, aggregateAttestationStub: any, processAttestationStub: any;

  beforeEach(function () {
    dbStub = {
      attestation: sandbox.createStubInstance(AttestationRepository),
      attestationData: sandbox.createStubInstance(AttestationDataRepository),
    };
    service = new AttestationOperations(dbStub.attestation, dbStub.attestationData, {config});
    aggregateAttestationStub = sandbox.stub(attestationUtils, "aggregateAttestation");
    canAggregateStub = sandbox.stub(attestationUtils, "canBeAggregated");
    processAttestationStub = sandbox.stub(blockOperations, "processAttestation");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should receive and store (no previous attestations", async function () {
    const data = generateEmptyAttestation();
    dbStub.attestationData.get.resolves([]);
    dbStub.attestation.set.resolves();
    await service.receive(data);
    expect(dbStub.attestation.get.called).to.be.false;
    expect(dbStub.attestationData.get.calledOnce).to.be.true;
    expect(canAggregateStub.called).to.be.false;
    expect(dbStub.attestation.setUnderRoot.calledOnce).to.be.true;
  });

  it("should receive without aggregation", async function () {
    const data = generateEmptyAttestation();

    dbStub.attestation.get.resolves(null);
    dbStub.attestationData.get.resolves([Buffer.alloc(32)]);
    canAggregateStub.returns(false);
    dbStub.attestation.set.resolves();
    await service.receive(data);
    expect(dbStub.attestation.get.calledOnce).to.be.true;
    expect(dbStub.attestationData.get.calledOnce).to.be.true;
    expect(aggregateAttestationStub.called).to.be.false;
    expect(dbStub.attestation.setUnderRoot.calledOnce).to.be.true;
  });

  it("should receive and aggregate", async function () {
    const data = generateEmptyAttestation();

    dbStub.attestation.get.resolves(data);
    dbStub.attestationData.get.resolves([Buffer.alloc(32)]);
    aggregateAttestationStub.resolves(data);
    canAggregateStub.returns(true);
    await service.receive(data);
    expect(dbStub.attestation.get.calledOnce).to.be.true;
    expect(dbStub.attestationData.get.calledOnce).to.be.true;
    expect(aggregateAttestationStub.called).to.be.true;
    //new and aggregated
    expect(dbStub.attestation.setUnderRoot.calledTwice).to.be.true;
    expect(dbStub.attestation.delete.calledOnce).to.be.true;
  });

  it("should get valid attestations", async function () {
    const data = generateEmptyAttestation();
    dbStub.attestation.getAll.resolves([data, data]);
    processAttestationStub.onFirstCall().throws().onSecondCall().returns(null);
    const result = await service.getValid(generateState({}, config));
    expect(result.length).to.be.equal(1);
  });

});
