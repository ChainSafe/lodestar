import {expect} from "chai";
import sinon from "sinon";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import {generateState} from "../../../../../utils/state";
import {GENESIS_EPOCH} from "../../../../../../src/constants/minimal";
import {processRewardsAndPenalties}
  from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates";
import * as attestationDeltas
  from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/attestation";
import * as crosslinkDeltas
  from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/crosslink";
import BN from "bn.js";
import {generateValidator} from "../../../../../utils/validator";

describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let getCurrentEpochStub,
    getAttestationDeltasStub,
    getCrosslinkDeltasStub,
    increaseBalanceStub,
    decreaseBalanceStub;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    increaseBalanceStub = sandbox.stub(utils, "increaseBalance");
    decreaseBalanceStub = sandbox.stub(utils, "decreaseBalance");
    getAttestationDeltasStub = sandbox.stub(attestationDeltas, "getAttestationDeltas");
    getCrosslinkDeltasStub = sandbox.stub(crosslinkDeltas, "getCrosslinkDeltas");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process rewards and penalties - genesis epoch', function () {
    const state = generateState();
    getCurrentEpochStub.returns(GENESIS_EPOCH);

    try {
      processRewardsAndPenalties(state);
      expect(getAttestationDeltasStub.called).to.be.false;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should process rewards and penalties', function () {
    const state = generateState();
    const reward = new BN(10);
    const penalty = new BN(0);
    state.validatorRegistry.push(generateValidator());
    getCurrentEpochStub.returns(10);
    getAttestationDeltasStub.returns([[reward], [penalty]]);
    getCrosslinkDeltasStub.returns([[reward], [penalty]]);

    try {
      processRewardsAndPenalties(state);
      expect(increaseBalanceStub.calledOnceWith(state, 0, reward.add(reward)));
      expect(decreaseBalanceStub.calledOnceWith(state, 0, penalty.add(penalty)));
    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
