import sinon from "sinon";
import {expect} from "chai";
import {describe, beforeEach, afterEach} from "mocha";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import * as utils from "../../../../src/util";
import {processBlockHeader} from "../../../../src/block";

import {generateState} from "../../../utils/state";
import {generateEmptyBlock} from "../../../utils/block";
import {generateValidator} from "../../../utils/validator";

describe("process block - block header", function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub: any, getBeaconProposeIndexStub: any;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("fail to process header - invalid slot", function () {
    const state = generateState({slot: 5n});
    const block = generateEmptyBlock();
    block.slot = 4n;
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
    }
  });

  it("fail to process header - invalid parent header", function () {
    const state = generateState({slot: 5n});
    const block = generateEmptyBlock();
    block.slot = 5n;
    block.parentRoot = Buffer.alloc(10, 1);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it("fail to process header - proposerSlashed", function () {
    const state = generateState({slot: 5n});
    state.validators.push(generateValidator({activation: 0n, exit: 10n, slashed: true}));
    const block = generateEmptyBlock();
    block.slot = 5n;
    block.parentRoot = config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
    }
  });

  it("should process block", function () {
    const state = generateState({slot: 5n});
    state.validators.push(generateValidator({activation: 0n, exit: 10n}));
    const block = generateEmptyBlock();
    block.slot = 5n;
    block.parentRoot = config.types.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader);
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(config, state, block);
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
