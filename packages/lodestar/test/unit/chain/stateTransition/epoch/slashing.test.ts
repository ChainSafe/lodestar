import BN from "bn.js";
import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {FAR_FUTURE_EPOCH} from "../../../../../src/constants";
import {processSlashings} from "../../../../../src/chain/stateTransition/epoch/slashings";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {intDiv} from "@chainsafe/eth2.0-utils";

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
    validator2.withdrawableEpoch = config.params.EPOCHS_PER_SLASHINGS_VECTOR;
    const validator3 = generateValidator(0, FAR_FUTURE_EPOCH, true);
    validator3.withdrawableEpoch = intDiv(config.params.EPOCHS_PER_SLASHINGS_VECTOR, 2) + 1;
    const state = generateState({
      validators: [
        validator1,
        validator2,
        validator3
      ]
    });
    try {
      processSlashings(config, state);
      expect(decreaseBalanceStub.withArgs(sinon.match.any, 2, sinon.match.any).calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });


});
