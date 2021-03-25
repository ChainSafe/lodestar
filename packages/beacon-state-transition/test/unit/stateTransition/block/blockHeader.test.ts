import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import * as utils from "../../../../src/util";
import {processBlockHeader} from "../../../../src/phase0/naive/block";

import {generateState} from "../../../utils/state";
import {generateEmptyBlock} from "../../../utils/block";
import {generateValidator} from "../../../utils/validator";
import {SinonStubFn} from "../../../utils/types";
import {BeaconBlock, BeaconState} from "@chainsafe/lodestar-types/phase0";

/* eslint-disable no-empty */

describe("process block - block header", function () {
  const sandbox = sinon.createSandbox();

  let getBeaconProposeIndexStub: SinonStubFn<typeof utils["getBeaconProposerIndex"]>,
    state: BeaconState,
    block: BeaconBlock;

  beforeEach(() => {
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    state = generateState({slot: 5});
    block = generateEmptyBlock();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("fail to process header - invalid slot", function () {
    block.slot = 4;
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it("fail to process header - invalid parent header", function () {
    block.slot = 5;
    block.parentRoot = Buffer.alloc(10, 1);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it("fail to process header - proposerSlashed", function () {
    state.validators.push(generateValidator({activation: 0, exit: 10, slashed: true}));
    block.slot = 5;
    block.parentRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it.skip("should process block", function () {
    state.validators.push(generateValidator({activation: 0, exit: 10}));
    block.slot = 5;
    block.parentRoot = config.types.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
    getBeaconProposeIndexStub.returns(0);

    processBlockHeader(config, state, block);
  });
});
