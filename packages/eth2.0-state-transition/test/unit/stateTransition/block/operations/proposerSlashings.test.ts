import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processProposerSlashing} from "../../../../../src/block/operations";
import * as utils from "../../../../../src/util";
import * as validatorUtils from "../../../../../src/util/validator";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateValidator} from "../../../../utils/validator";
import {generateState} from "../../../../utils/state";

describe("process block - proposer slashings", function () {

  const sandbox = sinon.createSandbox();

  let isSlashableValidatorStub: any, slashValidatorStub: any;

  beforeEach(() => {
    isSlashableValidatorStub = sandbox.stub(validatorUtils, "isSlashableValidator");
    slashValidatorStub = sandbox.stub(utils, "slashValidator");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process - different epoch", function () {
    const state = generateState({validators: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = config.params.SLOTS_PER_EPOCH + 1;
    try {
      processProposerSlashing(config, state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it("should fail to process - same headers", function () {
    const state = generateState({validators: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = proposerSlashing.header1.slot;
    try {
      processProposerSlashing(config, state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it("should fail to process - same headers", function () {
    const state = generateState({validators: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(false);
    try {
      processProposerSlashing(config, state, proposerSlashing);
      expect.fail();
    } catch (e) {
      // different slot so it failed without calling isSlashableValidator
      expect(isSlashableValidatorStub.calledOnce).to.be.false;
    }
  });

  it("should fail to process - invalid signature 1", function () {
    const state = generateState({validators: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 1;
    isSlashableValidatorStub.returns(true);
    try {
      processProposerSlashing(config, state, proposerSlashing, true);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it("should fail to process - invalid signature 2", function () {
    const validator = generateValidator();
    const state = generateState({validators: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header1.signature = Buffer.alloc(96, 1);
    proposerSlashing.header2.slot = 1;
    proposerSlashing.header2.signature = Buffer.alloc(96, 2);
    isSlashableValidatorStub.returns(true);
    try {
      processProposerSlashing(config, state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it("should process", function () {
    const validator = generateValidator();
    const state = generateState({validators: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 1;
    isSlashableValidatorStub.returns(true);
    try {
      processProposerSlashing(config, state, proposerSlashing, false);
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
      expect(slashValidatorStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
