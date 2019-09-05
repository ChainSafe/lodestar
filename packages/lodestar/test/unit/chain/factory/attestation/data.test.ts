import sinon from "sinon";
import {expect} from "chai";
import {describe, it} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {BlockRepository} from "../../../../../src/db/api/beacon/repositories";

describe("assemble attestation data", function () {

  const sandbox = sinon.createSandbox();
  let  dbStub;

  beforeEach(() => {
    dbStub = {
      block: sandbox.createStubInstance(BlockRepository)
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should produce attestation', async function () {
    const state = generateState({slot: 2});
    const block = generateEmptyBlock();
    dbStub.block.get.resolves(block);
    const result = await assembleAttestationData(config, dbStub, state, block, 2);
    expect(result).to.not.be.null;
    expect(dbStub.block.get.calledOnce).to.be.true;
  });

});
