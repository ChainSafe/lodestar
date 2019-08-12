import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processRandao} from "../../../../../src/chain/stateTransition/block/randao";
import * as utils from "../../../../../src/chain/stateTransition/util";

import {getCurrentEpoch} from "../../../../../src/chain/stateTransition/util";
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
    const state = generateState({validators: [generateValidator()]});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    blsStub.verify.returns(false);
    try {
      processRandao(config, state, block.body);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should process randao', function () {
    const validator = generateValidator();
    const state = generateState({validators: [validator]});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    blsStub.verify.returns(true);
    try {
      processRandao(config, state, block.body);
      expect(getBeaconProposerStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(state.randaoMixes[getCurrentEpoch(config, state) % config.params.EPOCHS_PER_HISTORICAL_VECTOR]).to.not.be.null;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
