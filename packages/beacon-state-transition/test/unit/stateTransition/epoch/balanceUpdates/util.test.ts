import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/mainnet";
import * as utils from "../../../../../src/util";
import {generateState} from "../../../../utils/state";
import {generateValidators} from "../../../../utils/validator";
import {getBaseReward} from "../../../../../src/phase0/naive/epoch/balanceUpdates/util";
import {bigIntSqrt} from "@chainsafe/lodestar-utils";
import {BASE_REWARDS_PER_EPOCH} from "../../../../../src/constants";
import {SinonStubFn} from "../../../../utils/types";

describe.skip("process epoch - balance updates", function () {
  const sandbox = sinon.createSandbox();
  let getTotalActiveBalanceStub: SinonStubFn<typeof utils["getTotalActiveBalance"]>;

  beforeEach(() => {
    getTotalActiveBalanceStub = sandbox.stub(utils, "getTotalActiveBalance");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should calculate base reward", function () {
    const state = generateState();
    getTotalActiveBalanceStub.returns(BigInt(100));
    state.validators = generateValidators(10);
    for (let index = 0; index < state.validators.length; index++) {
      state.validators[index].effectiveBalance = BigInt(index);
      const result = getBaseReward(config, state, index);
      const actual =
        (BigInt(index) * BigInt(config.params.BASE_REWARD_FACTOR)) /
        bigIntSqrt(BigInt(100)) /
        BigInt(BASE_REWARDS_PER_EPOCH);
      expect(result === actual).to.be.true;
    }
  });
});
