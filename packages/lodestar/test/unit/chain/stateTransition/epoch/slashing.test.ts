import * as utils from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";
import BN from "bn.js";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {FAR_FUTURE_EPOCH, LATEST_SLASHED_EXIT_LENGTH} from "@chainsafe/eth2-types";
import {expect} from "chai";
import {processSlashings} from "../../../../../src/chain/stateTransition/epoch/slashings";

describe('process epoch - slashings', function () {

  const sandbox = sinon.createSandbox();

  let getCurrentEpochStub,
    getTotalBalanceStub,
    getActiveValidatorIndicesStub,
    decreaseBalanceStub;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    getTotalBalanceStub = sandbox.stub(utils, "getTotalBalance");
    getActiveValidatorIndicesStub = sandbox.stub(utils, "getActiveValidatorIndices");
    decreaseBalanceStub = sandbox.stub(utils, "decreaseBalance");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should decrease validator balances with penalty', function () {
    getCurrentEpochStub.returns(1);
    getTotalBalanceStub.returns(new BN(2));
    const validator1 = generateValidator(0, FAR_FUTURE_EPOCH, false);
    const validator2 = generateValidator(0, FAR_FUTURE_EPOCH, true);
    validator2.withdrawableEpoch = LATEST_SLASHED_EXIT_LENGTH;
    const validator3 = generateValidator(0, FAR_FUTURE_EPOCH, true);
    validator3.withdrawableEpoch = LATEST_SLASHED_EXIT_LENGTH + 2;
    const state = generateState({
      validatorRegistry: [
        validator1,
        validator2,
        validator3
      ]
    });
    try {
      processSlashings(state);
      expect(decreaseBalanceStub.withArgs(sinon.match.any, 2, sinon.match.any).calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });


});
