import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";

import {MAX_PROPOSER_SLASHINGS, SLOTS_PER_EPOCH} from "../../../../../../constants";
import {processProposerSlashing} from "../../../../../../chain/stateTransition/block/operations";
import * as utils from "../../../../../../chain/stateTransition/util";

import {generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {generateValidator} from "../../../../../utils/validator";
import {generateState} from "../../../../../utils/state";
import {generateEmptyBlock} from "../../../../../utils/block";

describe('process block - proposer slashings', function () {

  const sandbox = sinon.createSandbox();

  let isSlashableValidatorStub, slashValidatorStub, blsStub;

  beforeEach(() => {
    isSlashableValidatorStub = sandbox.stub(utils, "isSlashableValidator");
    slashValidatorStub = sandbox.stub(utils, "slashValidator");
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('should fail to process - different epoch', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = SLOTS_PER_EPOCH + 1;
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it('should fail to process - same headers', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = proposerSlashing.header1.slot;
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it('should fail to process - same headers', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(false);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process - invalid signature 1', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    blsStub.verify.returns(false);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process - invalid signature 2', function () {
    const validator = generateValidator();
    const state = generateState({validatorRegistry: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header1.signature = Buffer.alloc(96, 1);
    proposerSlashing.header2.slot = 2;
    proposerSlashing.header2.signature = Buffer.alloc(96, 2);
    isSlashableValidatorStub.returns(true);
    blsStub.verify
      .withArgs(sinon.match.any, sinon.match.any, proposerSlashing.header1.signature, sinon.match.any)
      .returns(true);
    blsStub.verify
      .withArgs(sinon.match.any, sinon.match.any, proposerSlashing.header2.signature, sinon.match.any)
      .returns(false);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(blsStub.verify.calledTwice).to.be.true;
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should process', function () {
    const validator = generateValidator();
    const state = generateState({validatorRegistry: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    blsStub.verify.returns(true);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
      expect(slashValidatorStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledTwice).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
