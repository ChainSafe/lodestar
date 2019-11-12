import BN from "bn.js";
import sinon from "sinon";
import {expect} from "chai";
import * as hashTreeRoot from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../src/util";
import {processFinalUpdates} from "../../../../src/epoch/finalUpdates";

import {generateState} from "../../../utils/state";
import {generateValidator} from "../../../utils/validator";

describe('process epoch - final updates', function () {

  const sandbox = sinon.createSandbox();

  let getCurrentEpochStub: any,
    getRandaoMixStub: any,
    hashTreeRootStub: any;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    getRandaoMixStub = sandbox.stub(utils, "getRandaoMix");
    hashTreeRootStub = sandbox.stub(hashTreeRoot, "hashTreeRoot");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required final updates', function () {
    const state = generateState();
    state.slot = config.params.SLOTS_PER_ETH1_VOTING_PERIOD - 1;
    state.validators.push(generateValidator());
    state.balances.push(new BN("ffffffffff",16));

    getCurrentEpochStub.returns(127);
    getRandaoMixStub.returns(0);
    hashTreeRootStub.returns(Buffer.from("1010"));

    try {
      processFinalUpdates(config, state);
      expect(getCurrentEpochStub.calledOnceWith(config, state)).to.be.true;
      expect(getRandaoMixStub.calledOnceWith(config, state, sinon.match.number)).to.be.true;

    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
