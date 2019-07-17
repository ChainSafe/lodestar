import BN from "bn.js";
import {expect} from "chai";
import sinon from "sinon";
import * as utilsEpoch from "../../../../../../src/chain/stateTransition/epoch/util";
import {bnSqrt} from "../../../../../../src/util/math";
import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {getBaseReward} from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/baseReward";
import {createIBeaconConfig} from "../../../../../../src/config";
import * as mainnetParams from "../../../../../../src/params/presets/mainnet";

describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let getTotalActiveBalanceStub;
  let config = createIBeaconConfig(mainnetParams);

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
      const result = getBaseReward(config, state, index);
      const actual = new BN(index).muln(config.params.BASE_REWARD_FACTOR)
        .div(bnSqrt(new BN(100))).divn(config.params.BASE_REWARDS_PER_EPOCH);
      expect(result.eq(actual)).to.be.true;


    });

  });

});
