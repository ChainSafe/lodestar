import sinon from "sinon";
import {expect} from "chai";

import {List} from "@chainsafe/ssz";
import {Validator} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as utils from "../../../../src/util";
import {initiateValidatorExit} from "../../../../src/util";
import {processRegistryUpdates} from "../../../../src/epoch/registryUpdates";
import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";

describe('process epoch - slashings', function () {

  const sandbox = sinon.createSandbox();

  let getCurrentEpochStub: any,
    isActiveValidatorStub: any,
    initiateValidatorExitStub: any;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
    initiateValidatorExitStub = sandbox.stub(utils, "initiateValidatorExit");
    sandbox.stub(utils, "computeActivationExitEpoch").returns(1);
    sandbox.stub(utils, "getValidatorChurnLimit").returns(1);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required registry updates', function () {
    getCurrentEpochStub.returns(1);
    const validatorEligble = generateValidator();
    validatorEligble.effectiveBalance = BigInt(config.params.MAX_EFFECTIVE_BALANCE);

    const validatorToExit = generateValidator({activation: 1});
    validatorToExit.effectiveBalance = 1n;
    isActiveValidatorStub.withArgs(sinon.match.any, sinon.match.any).returns(true);
    const state = generateState({validators: [validatorEligble, validatorToExit] as List<Validator>});
    try {
      processRegistryUpdates(config, state);
      expect(initiateValidatorExitStub.calledOnceWith(sinon.match.any, sinon.match.any, 1)).to.be.true;
      expect(state.validators[0].activationEligibilityEpoch).to.be.equal(2);
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
