import BN from "bn.js";
import sinon from "sinon";
import {expect} from "chai";

import {config} from "../../../../../src/config/presets/mainnet";
import * as utils1 from "../../../../../src/chain/stateTransition/util";
import * as utils2 from "../../../../../src/chain/stateTransition/epoch/util";
import {generateState} from "../../../../utils/state";
import {processJustificationAndFinalization}
  from "../../../../../src/chain/stateTransition/epoch/justification";
import { BitVector } from "@chainsafe/bit-utils";

describe('process epoch - justification and finalization', function () {

  const sandbox = sinon.createSandbox();

  let getBlockRootStub,
    getCurrentEpochStub,
    getPreviousEpochStub,
    getAttestingBalanceStub,
    getMatchingTargetAttestationsStub,
    getTotalActiveBalanceStub;

  beforeEach(() => {
    getBlockRootStub = sandbox.stub(utils1, "getBlockRoot");
    getCurrentEpochStub = sandbox.stub(utils1, "getCurrentEpoch");
    getPreviousEpochStub = sandbox.stub(utils1, "getPreviousEpoch");
    getAttestingBalanceStub = sandbox.stub(utils2, "getAttestingBalance");
    getMatchingTargetAttestationsStub = sandbox.stub(utils2, "getMatchingTargetAttestations");
    getTotalActiveBalanceStub = sandbox.stub(utils1, "getTotalActiveBalance");

  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should make required justification and finalization', function () {
    const state = generateState();
    let previousJustifiedEpoch;
    let currentJustifiedEpoch;
    getTotalActiveBalanceStub.returns(new BN(10));
    getAttestingBalanceStub.returns(new BN(10));
    state.justificationBits = BitVector.fromBitfield(Buffer.from([7, 0, 0, 0, 0, 0, 0, 0]), 64);

    getCurrentEpochStub.returns(1);
    processJustificationAndFinalization(config, state);
    expect(getCurrentEpochStub.calledOnceWith(config, state)).to.be.true;

    // hit 1st if condition of finalization
    state.previousJustifiedCheckpoint.epoch = previousJustifiedEpoch = 0;
    getBlockRootStub.returns(Buffer.alloc(32));
    getCurrentEpochStub.returns(3);
    getPreviousEpochStub.returns(1);
    processJustificationAndFinalization(config, state);
    expect(state.finalizedCheckpoint.epoch).to.be.equal(previousJustifiedEpoch);

    // hit 2nd if condition of finalization
    getCurrentEpochStub.returns(2);
    state.previousJustifiedCheckpoint.epoch = previousJustifiedEpoch = 0;
    processJustificationAndFinalization(config, state);
    expect(state.finalizedCheckpoint.epoch).to.be.equal(previousJustifiedEpoch);

    // hit 3rd if condition of finalization
    state.currentJustifiedCheckpoint.epoch = currentJustifiedEpoch = 0;
    getCurrentEpochStub.returns(2);
    processJustificationAndFinalization(config, state);
    expect(state.finalizedCheckpoint.epoch).to.be.equal(currentJustifiedEpoch);

    // hit 4th if condition of finalization
    getCurrentEpochStub.returns(2);
    state.previousJustifiedCheckpoint.epoch = 1;
    state.currentJustifiedCheckpoint.epoch = currentJustifiedEpoch = 1;
    processJustificationAndFinalization(config, state);
    expect(state.finalizedCheckpoint.epoch).to.be.equal(currentJustifiedEpoch);

    expect(getPreviousEpochStub.callCount).to.be.equal(4);
    expect(getTotalActiveBalanceStub.callCount).to.be.equal(4);
    expect(getTotalActiveBalanceStub.callCount).to.be.equal(4);
    expect(getAttestingBalanceStub.callCount).to.be.equal(8);
    expect(getMatchingTargetAttestationsStub.callCount).to.be.equal(8);

  });

});
