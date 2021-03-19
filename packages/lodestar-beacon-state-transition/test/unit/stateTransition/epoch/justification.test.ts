import sinon from "sinon";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/mainnet";
import * as utils1 from "../../../../src/util";
import * as utils2 from "../../../../src/phase0/naive/epoch/util";
import {generateState} from "../../../utils/state";
import {processJustificationAndFinalization} from "../../../../src/phase0/naive/epoch/justification";
import {SinonStubFn} from "../../../utils/types";

describe.skip("process epoch - justification and finalization", function () {
  const sandbox = sinon.createSandbox();

  let getBlockRootStub: SinonStubFn<typeof utils1["getBlockRoot"]>,
    getCurrentEpochStub: SinonStubFn<typeof utils1["getCurrentEpoch"]>,
    getPreviousEpochStub: SinonStubFn<typeof utils1["getPreviousEpoch"]>,
    getAttestingBalanceStub: SinonStubFn<typeof utils2["getAttestingBalance"]>,
    getMatchingTargetAttestationsStub: SinonStubFn<typeof utils2["getMatchingTargetAttestations"]>,
    getTotalActiveBalanceStub: SinonStubFn<typeof utils1["getTotalActiveBalance"]>;

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

  it("should make required justification and finalization", function () {
    const state = generateState();
    let previousJustifiedEpoch;
    let currentJustifiedEpoch;
    getTotalActiveBalanceStub.returns(BigInt(10));
    getAttestingBalanceStub.returns(BigInt(10));
    state.justificationBits = Array.from({length: 64}, () => false);

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
