import BN from "bn.js";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import {bnSqrt} from "../../../../../../src/util/math";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {getBaseReward} from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/baseReward";

describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let getTotalActiveBalanceStub;

  beforeEach(() => {
    getTotalActiveBalanceStub = sandbox.stub(utils, "getTotalActiveBalance");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should calculate base reward', function () {
    const state = generateState();
    getTotalActiveBalanceStub.returns(new BN(100));
    state.validators = generateValidators(10);
    state.validators.forEach((value, index)=>{
      state.validators[index].effectiveBalance = new BN(index);
      const result = getBaseReward(config, state, index);
      const actual = new BN(index).muln(config.params.BASE_REWARD_FACTOR)
        .div(bnSqrt(new BN(100))).divn(config.params.BASE_REWARDS_PER_EPOCH);
      expect(result.eq(actual)).to.be.true;


    });

  });

});
