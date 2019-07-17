import sinon from "sinon";
import {expect} from "chai";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {BeaconDB} from "../../../../../src/db/api";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe("assemble attestation data", function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);
  let  dbStub;

  beforeEach(() => {
    dbStub = sandbox.createStubInstance(BeaconDB);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should produce attestation', async function () {
    const state = generateState({slot: 2});
    const block = generateEmptyBlock();
    dbStub.getBlock.resolves(block);
    const result = await assembleAttestationData(config, dbStub, state, block, 2);
    expect(result).to.not.be.null;
    expect(dbStub.getBlock.calledOnce).to.be.true;
  });

});
