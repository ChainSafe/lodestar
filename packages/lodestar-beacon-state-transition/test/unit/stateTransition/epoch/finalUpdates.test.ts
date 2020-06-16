import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as utils from "../../../../src/util";
import {processFinalUpdates} from "../../../../src/epoch/finalUpdates";

import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";

describe('process epoch - final updates', function () {

  const sandbox = sinon.createSandbox();

  let getCurrentEpochStub: any,
    getRandaoMixStub: any;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    getRandaoMixStub = sandbox.stub(utils, "getRandaoMix");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required final updates', function () {
    const state = generateState();
    state.slot = config.params.EPOCHS_PER_ETH1_VOTING_PERIOD - 1n;
    state.validators.push(generateValidator());
    state.balances.push(0xffffffffffn);

    getCurrentEpochStub.returns(127);
    getRandaoMixStub.returns(0);

    try {
      processFinalUpdates(config, state);
      expect(getCurrentEpochStub.calledOnceWith(config, state)).to.be.true;
      expect(getRandaoMixStub.calledOnceWith(config, state, sinon.match.number)).to.be.true;

    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
