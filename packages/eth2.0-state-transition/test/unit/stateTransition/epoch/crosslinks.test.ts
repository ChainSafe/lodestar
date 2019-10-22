import BN from "bn.js";
import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../../eth2.0-state-transition/src/util";
import {
  getCrosslinkCommittee,
  getCommitteeCount,
  getStartShard
} from "../../../../../eth2.0-state-transition/src/util";
import * as epochUtils from "../../../../../eth2.0-state-transition/src/epoch/util";
import {getWinningCrosslinkAndAttestingIndices} from "../../../../../eth2.0-state-transition/src/epoch/util";
import {processCrosslinks} from "../../../../../eth2.0-state-transition/src/epoch/crosslinks";
import {generateEmptyCrosslink} from "../../../utils/crosslink";
import {generateState} from "../../../utils/state";

describe('process epoch - crosslinks', function () {

  const sandbox = sinon.createSandbox();

  let getCurrentEpochStub: any,
    getPreviousEpochStub: any,
    getEpochStartShardStub: any,
    getCrosslinkCommitteeStub: any,
    getEpochCommitteeCountStub: any,
    getTotalBalanceStub: any,
    getWinningCrosslinkAndAttestingIndicesStub: any;

  beforeEach(() => {
    getCurrentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    getPreviousEpochStub = sandbox.stub(utils, "getPreviousEpoch");
    getEpochStartShardStub = sandbox.stub(utils, "getStartShard");
    getEpochCommitteeCountStub = sandbox.stub(utils, "getCommitteeCount");
    getCrosslinkCommitteeStub = sandbox.stub(utils, "getCrosslinkCommittee");
    getTotalBalanceStub = sandbox.stub(utils, "getTotalBalance");
    getWinningCrosslinkAndAttestingIndicesStub =
      sandbox.stub(epochUtils, "getWinningCrosslinkAndAttestingIndices");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should set crosslink', function () {
    const state = generateState();
    const crosslink = generateEmptyCrosslink(1);
    const crosslinks = state.currentCrosslinks.slice();
    getCurrentEpochStub.returns(1);
    getPreviousEpochStub.returns(0);
    getEpochStartShardStub.returns(1);
    getEpochCommitteeCountStub.returns(1);
    getCrosslinkCommitteeStub.returns([1, 2, 3]);
    getWinningCrosslinkAndAttestingIndicesStub.returns([
      crosslink,
      [4, 5, 6]
    ]);
    getTotalBalanceStub.returns(new BN(1));
    try {
      processCrosslinks(config, state);
      expect(getCurrentEpochStub.calledOnce).to.be.true;
      expect(getPreviousEpochStub.calledOnce).to.be.true;
      expect(getPreviousEpochStub.calledOnce).to.be.true;
      expect(getEpochCommitteeCountStub.calledTwice).to.be.true;
      expect(getEpochStartShardStub.calledTwice).to.be.true;
      expect(getWinningCrosslinkAndAttestingIndicesStub.calledTwice).to.be.true;
      expect(getCrosslinkCommitteeStub.calledTwice).to.be.true;
      expect(getTotalBalanceStub.callCount).to.be.equal(4);
      expect(state.currentCrosslinks[1]).to.be.deep.equal(crosslink);
      expect(state.previousCrosslinks).to.be.deep.equal(crosslinks);
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should not set crosslink', function () {
    const crossLink = generateEmptyCrosslink();
    const state = generateState();
    state.currentCrosslinks.push(crossLink);
    getCurrentEpochStub.returns(1);
    getPreviousEpochStub.returns(0);
    getEpochStartShardStub.returns(1);
    getEpochCommitteeCountStub.returns(1);
    getCrosslinkCommitteeStub.returns([1, 2, 3]);
    getWinningCrosslinkAndAttestingIndicesStub.returns([
      crossLink,
      [4, 5, 6]
    ]);
    getTotalBalanceStub.withArgs(sinon.match.any, [4, 5, 6]).returns(new BN(1));
    getTotalBalanceStub.withArgs(sinon.match.any, [1, 2, 3]).returns(new BN(5));
    try {
      processCrosslinks(config, state);
      expect(getCurrentEpochStub.calledOnce).to.be.true;
      expect(getPreviousEpochStub.calledOnce).to.be.true;
      expect(getPreviousEpochStub.calledOnce).to.be.true;
      expect(getEpochCommitteeCountStub.calledTwice).to.be.true;
      expect(getEpochStartShardStub.calledTwice).to.be.true;
      expect(getWinningCrosslinkAndAttestingIndicesStub.calledTwice).to.be.true;
      expect(getCrosslinkCommitteeStub.calledTwice).to.be.true;
      expect(getTotalBalanceStub.callCount).to.be.equal(4);
      expect(state.currentCrosslinks[1]).to.be.deep.equal(generateEmptyCrosslink());
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
