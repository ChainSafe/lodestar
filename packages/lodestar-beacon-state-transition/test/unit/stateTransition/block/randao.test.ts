import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {processRandao} from "../../../../src/block";
import * as utils from "../../../../src/util";
import {describe, beforeEach, afterEach} from "mocha";
import {getCurrentEpoch} from "../../../../src/util";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {generateValidators} from "../../../utils/validator";

describe("process block - randao", function () {

  const sandbox = sinon.createSandbox();

  let getBeaconProposerStub: any;

  beforeEach(() => {
    getBeaconProposerStub = sandbox.stub(utils, "getBeaconProposerIndex");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process - invalid randao signature", function () {
    const state = generateState({validators: generateValidators(0)});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    try {
      processRandao(config, state, block.body);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerStub.calledOnce).to.be.true;
    }
  });

  it("should process randao", function () {
    const state = generateState({validators: generateValidators(1)});
    const block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
    try {
      processRandao(config, state, block.body, false);
      expect(getBeaconProposerStub.calledOnce).to.be.true;
      expect(state.randaoMixes[getCurrentEpoch(config, state) % config.params.EPOCHS_PER_HISTORICAL_VECTOR]).to.not.be.null;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
