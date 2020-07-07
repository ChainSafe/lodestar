import sinon, { SinonStub } from "sinon";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as attestationDataProduction from "../../../../../src/chain/factory/attestation/data";
import {BeaconDb, IBeaconDb} from "../../../../../src/db/api";
import {assembleAttestation} from "../../../../../src/chain/factory/attestation";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateAttestationData} from "../../../../utils/attestation";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, BeaconBlock, AttestationData} from "@chainsafe/lodestar-types";

describe("assemble attestation", function () {

  const sandbox = sinon.createSandbox();
  let assembleAttestationDataStub: SinonStub<[IBeaconConfig, IBeaconDb, BeaconState, BeaconBlock, number, number], Promise<AttestationData>>, dbStub: IBeaconDb;

  beforeEach(() => {
    assembleAttestationDataStub = sandbox.stub(
      attestationDataProduction,
      "assembleAttestationData"
    );
    dbStub = sandbox.createStubInstance(BeaconDb);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should produce attestation", async function () {
    const state = generateState({slot: 1});
    const attestationData = generateAttestationData(1, 3);
    assembleAttestationDataStub.resolves(attestationData);
    const result = await assembleAttestation({config, db: dbStub}, state, generateEmptyBlock(), 1, 4, 2);
    //TODO: try to test if validator bit is correctly set
    expect(result).to.not.be.null;
    expect(result.data).to.be.equal(attestationData);
    expect(state.slot).to.be.equal(1);
    expect(assembleAttestationDataStub.calledOnceWith(config, dbStub, state, generateEmptyBlock(), 2, 0));
  });

});
