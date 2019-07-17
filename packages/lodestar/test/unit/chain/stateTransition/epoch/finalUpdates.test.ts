import BN from "bn.js";
import sinon from "sinon";
import {expect} from "chai";
import * as hashTreeRoot from "@chainsafe/ssz";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {processFinalUpdates} from "../../../../../src/chain/stateTransition/epoch/finalUpdates";

import {generateState} from "../../../../utils/state";
import {generateValidator} from "../../../../utils/validator";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe('process epoch - final updates', function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);

  let getActiveValidatorIndicesStub,
    getCurrentEpochStub,
    getRandaoMixStub,
    getShardDeltaStub,
    hashTreeRootStub;

  beforeEach(() => {
    getActiveValidatorIndicesStub = sandbox.stub(utils, "getActiveValidatorIndices");
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    getRandaoMixStub = sandbox.stub(utils, "getRandaoMix");
    getShardDeltaStub = sandbox.stub(utils, "getShardDelta");
    hashTreeRootStub = sandbox.stub(hashTreeRoot, "hashTreeRoot");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required final updates', function () {
    const state = generateState();
    state.slot = config.params.SLOTS_PER_ETH1_VOTING_PERIOD - 1;
    state.validatorRegistry.push(generateValidator());
    state.balances.push(new BN("fffffffff"));

    getCurrentEpochStub.returns(127);
    getShardDeltaStub.returns(1);
    getActiveValidatorIndicesStub.returns([1,2,3,4]);
    getRandaoMixStub.returns(0);
    hashTreeRootStub.returns(Buffer.from("1010"));

    try {
      processFinalUpdates(config, state);
      expect(getCurrentEpochStub.calledOnceWith(config, state)).to.be.true;
      expect(getShardDeltaStub.calledOnceWith(config, state, sinon.match.number)).to.be.true;
      expect(getActiveValidatorIndicesStub.calledOnceWith(state, sinon.match.number)).to.be.true;
      expect(getRandaoMixStub.calledOnceWith(config, state, sinon.match.number)).to.be.true;

    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
