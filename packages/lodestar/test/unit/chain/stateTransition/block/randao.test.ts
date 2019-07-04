import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";

import {Domain, LATEST_RANDAO_MIXES_LENGTH} from "../../../../../constants";
import {processRandao} from "../../../../../chain/stateTransition/block/randao";
import * as utils from "../../../../../chain/stateTransition/util";

import {getCurrentEpoch, getDomain} from "../../../../../chain/stateTransition/util";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";

describe('process block - randao', function () {

  const sandbox = sinon.createSandbox();

  let getBeaconProposerStub, blsStub;

  beforeEach(() => {
    getBeaconProposerStub = sandbox.stub(utils, "getBeaconProposerIndex");
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('should fail to process - invalid randao signature', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    blsStub.verify.returns(false);
    try {
      processRandao(state, block.body);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should process randao', function () {
    const validator = generateValidator();
    const state = generateState({validatorRegistry: [validator]});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    blsStub.verify.returns(true);
    try {
      processRandao(state, block.body);
      expect(getBeaconProposerStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(state.latestRandaoMixes[getCurrentEpoch(state) % LATEST_RANDAO_MIXES_LENGTH]).to.not.be.null;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
