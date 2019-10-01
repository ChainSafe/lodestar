import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {
  FAR_FUTURE_EPOCH,
} from "../../../../../../src/constants";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import {processVoluntaryExit} from "../../../../../../src/chain/stateTransition/block/operations";

import {generateValidator} from "../../../../../utils/validator";
import {generateEmptyVoluntaryExit} from "../../../../../utils/voluntaryExits";
import {generateState} from "../../../../../utils/state";

describe('process block - voluntary exits', function () {

  const sandbox = sinon.createSandbox();

  let isActiveValidatorStub, initiateValidatorExitStub, blsStub;

  beforeEach(() => {
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
    initiateValidatorExitStub = sandbox.stub(utils, "initiateValidatorExit");
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('should fail - validator not active', function () {
    const state = generateState();
    const exit = generateEmptyVoluntaryExit();
    state.validators.push(generateValidator());
    isActiveValidatorStub.returns(false);
    try {
      processVoluntaryExit(config, state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - already exited', function () {
    const state = generateState();
    const exit = generateEmptyVoluntaryExit();
    state.validators.push(generateValidator({activation: 0, exit: 1}));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(config, state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - not valid', function () {
    const state = generateState({slot: 0});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = config.params.SLOTS_PER_EPOCH * 2;
    state.validators.push(generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH}));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(config, state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - validator not enough active', function () {
    const state = generateState({slot: config.params.SLOTS_PER_EPOCH * 2});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    state.validators.push(generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH}));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(config, state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - invalid signature', function () {
    const state = generateState({slot: (config.params.PERSISTENT_COMMITTEE_PERIOD + 1) * config.params.SLOTS_PER_EPOCH});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    state.validators.push(generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH}));
    isActiveValidatorStub.returns(true);
    blsStub.verify.returns(false);
    try {
      processVoluntaryExit(config, state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should process exit', function () {
    const validator = generateValidator({activation: 1, exit: FAR_FUTURE_EPOCH});
    const state = generateState({slot: (config.params.PERSISTENT_COMMITTEE_PERIOD + 1) * config.params.SLOTS_PER_EPOCH});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    blsStub.verify.returns(true);
    state.validators.push(validator);
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(config, state, exit);
      expect(isActiveValidatorStub.calledOnce).to.be.true;
      expect(initiateValidatorExitStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
