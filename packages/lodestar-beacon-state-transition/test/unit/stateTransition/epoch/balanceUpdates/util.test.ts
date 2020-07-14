import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as utils from "../../../../../src/util";
import {generateState} from "../../../../utils/state";
import {generateValidators} from "../../../../utils/validator";
import {getBaseReward} from "../../../../../src/epoch/balanceUpdates/util";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH} from "../../../../constants";

describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let getTotalActiveBalanceStub: any;

  beforeEach(() => {
    getTotalActiveBalanceStub = sandbox.stub(utils, "getTotalActiveBalance");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should calculate base reward', function () {
    const state = generateState();
    getTotalActiveBalanceStub.returns(100n);
    state.validators = generateValidators(10);
    state.validators.forEach((value, index)=>{
      state.validators[index].effectiveBalance = BigInt(index);
      const result = getBaseReward(config, state, index);
      const actual = BigInt(index)
        * BigInt(config.params.BASE_REWARD_FACTOR)
        / bigIntSqrt(100n)
        / BigInt(BASE_REWARDS_PER_EPOCH)
      expect(result === actual).to.be.true;


    });

  });

});
