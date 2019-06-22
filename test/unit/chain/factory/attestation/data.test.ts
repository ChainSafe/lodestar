import sinon from "sinon";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {BeaconDB} from "../../../../../src/db/api";
import {generateEmptyBlock} from "../../../../utils/block";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";

describe("assemble attestation data", function () {

  const sandbox = sinon.createSandbox();
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
    const result = await assembleAttestationData(dbStub, state, block, 2);
    //expect(result).to.not.be.null;
    //expect(dbStub.getBlock.calledOnce).to.be.true;
  });

});
