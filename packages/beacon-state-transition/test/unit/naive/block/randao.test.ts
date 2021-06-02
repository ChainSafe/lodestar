import {expect} from "chai";
import sinon from "sinon";
import {processRandao} from "../../../../src/naive/phase0/block";
import * as utils from "../../../../src/util";
import {getCurrentEpoch} from "../../../../src/util";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {generateValidators} from "../../../utils/validator";
import {SinonStubFn} from "../../../utils/types";
import {BeaconBlock} from "@chainsafe/lodestar-types/phase0";
import {EPOCHS_PER_HISTORICAL_VECTOR} from "@chainsafe/lodestar-params";

describe.skip("process block - randao", function () {
  const sandbox = sinon.createSandbox();

  let getBeaconProposerStub: SinonStubFn<typeof utils["getBeaconProposerIndex"]>, block: BeaconBlock;

  beforeEach(() => {
    getBeaconProposerStub = sandbox.stub(utils, "getBeaconProposerIndex");
    block = generateEmptyBlock();
    getBeaconProposerStub.returns(0);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process - invalid randao signature", function () {
    const state = generateState({validators: generateValidators(0)});
    try {
      processRandao(state, block.body);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerStub.calledOnce).to.be.true;
    }
  });

  it("should process randao", function () {
    const state = generateState({validators: generateValidators(1)});

    processRandao(state, block.body, false);
    expect(getBeaconProposerStub.calledOnce).to.be.true;
    expect(state.randaoMixes[getCurrentEpoch(state) % EPOCHS_PER_HISTORICAL_VECTOR]).to.not.be.null;
  });
});
