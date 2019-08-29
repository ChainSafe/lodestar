import sinon from "sinon";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {describe, it} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as attestationDataProduction from "../../../../../src/chain/factory/attestation/data";
import {BeaconDb} from "../../../../../src/db/api";
import {assembleAttestation} from "../../../../../src/chain/factory/attestation";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateAttestationData} from "../../../../utils/attestation";

describe("assemble attestation", function () {

  const sandbox = sinon.createSandbox();
  let assembleAttestationDataStub, dbStub;

  beforeEach(() => {
    assembleAttestationDataStub = sandbox.stub(
      attestationDataProduction,
      'assembleAttestationData'
    );
    dbStub = sandbox.createStubInstance(BeaconDb);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should produce attestation', async function () {
    const state = generateState({slot: 1});
    const attestationData = generateAttestationData(1, 3);
    assembleAttestationDataStub.resolves(attestationData);
    const result = await assembleAttestation(config, dbStub, state, generateEmptyBlock(), 4, 2);
    expect(result).to.not.be.null;
    expect(result.data).to.be.equal(attestationData);
    expect(state.slot).to.be.equal(4);
    expect(assembleAttestationDataStub.calledOnceWith(dbStub, state, generateEmptyBlock(), 2));
  });

});
