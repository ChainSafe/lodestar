import sinon from "sinon";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import * as attestationDataProduction from "../../../../../src/chain/factory/attestation/data";
import {BeaconDB} from "../../../../../src/db/api";
import {assembleAttestation} from "../../../../../src/chain/factory/attestation";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateAttestationData} from "../../../../utils/attestation";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe("assemble attestation", function () {

  const sandbox = sinon.createSandbox();
  let assembleAttestationDataStub, dbStub;
  let config = createIBeaconConfig(mainnetParams);

  beforeEach(() => {
    assembleAttestationDataStub = sandbox.stub(
      attestationDataProduction,
      'assembleAttestationData'
    );
    dbStub = sandbox.createStubInstance(BeaconDB);
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
