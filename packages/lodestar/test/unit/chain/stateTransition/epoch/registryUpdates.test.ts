import sinon from "sinon";
import BN from "bn.js";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {initiateValidatorExit} from "../../../../../src/chain/stateTransition/util";
import {processRegistryUpdates} from "../../../../../src/chain/stateTransition/epoch/registryUpdates";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe('process epoch - slashings', function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);

  let getCurrentEpochStub,
    isActiveValidatorStub,
    initiateValidatorExitStub;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
    initiateValidatorExitStub = sandbox.stub(utils, "initiateValidatorExit");
    sandbox.stub(utils, "getDelayedActivationExitEpoch").returns(1);
    sandbox.stub(utils, "getChurnLimit").returns(1);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required registry updates', function () {
    getCurrentEpochStub.returns(1);
    const validatorEligble = generateValidator();
    validatorEligble.effectiveBalance = new BN(config.params.MAX_EFFECTIVE_BALANCE);

    const validatorToExit = generateValidator(1);
    validatorToExit.effectiveBalance = new BN("1");
    isActiveValidatorStub.withArgs(sinon.match.any, sinon.match.any).returns(true);
    const state = generateState({validatorRegistry: [validatorEligble, validatorToExit]});
    try {
      processRegistryUpdates(config, state);
      expect(initiateValidatorExitStub.calledOnceWith(sinon.match.any, sinon.match.any, 1)).to.be.true;
      expect(state.validatorRegistry[0].activationEligibilityEpoch).to.be.equal(1);
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
