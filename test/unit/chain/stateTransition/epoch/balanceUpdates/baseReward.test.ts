import {expect} from "chai";
import sinon from "sinon";
import * as utilsEpoch from "../../../../../../src/chain/stateTransition/epoch/util";
import {generateState} from "../../../../../utils/state";
import BN from "bn.js";
import {generateValidators} from "../../../../../utils/validator";
import {getBaseReward} from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/baseReward";
import {BASE_REWARD_FACTOR, BASE_REWARDS_PER_EPOCH} from "../../../../../../src/constants";
import {bnSqrt} from "../../../../../../src/util/math";

describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let getTotalActiveBalanceStub;

  beforeEach(() => {
    getTotalActiveBalanceStub = sandbox.stub(utilsEpoch, "getTotalActiveBalance");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should calculate base reward', function () {
    const state = generateState();
    getTotalActiveBalanceStub.returns(new BN(100));
    state.validatorRegistry = generateValidators(10);
    state.validatorRegistry.forEach((value, index)=>{
      state.validatorRegistry[index].effectiveBalance = new BN(index);
      const result = getBaseReward(state, index);
      const actual = new BN(index).muln(BASE_REWARD_FACTOR)
        .div(bnSqrt(new BN(100))).divn(BASE_REWARDS_PER_EPOCH);
      expect(result.eq(actual)).to.be.true;


    });

  });

});
