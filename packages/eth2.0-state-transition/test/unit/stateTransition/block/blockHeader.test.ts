import sinon from "sinon";
import {expect} from "chai";
import {hashTreeRoot} from "@chainsafe/ssz";
import {describe, beforeEach, afterEach} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {EMPTY_SIGNATURE} from "../../../../src/constants";
import * as utils from "../../../../src/util";
import * as utilsProposer from "../../../../src/util/proposer";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../src/util";
import {processBlockHeader} from "../../../../src/block";

import {generateState} from "../../../utils/state";
import {generateEmptyBlock} from "../../../utils/block";
import {generateValidator} from "../../../utils/validator";

describe("process block - block header", function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub: any, getBeaconProposeIndexStub: any, isValidProposerStub: any;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utilsProposer, "getBeaconProposerIndex");
    isValidProposerStub = sandbox.stub(utils, "isValidProposer");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("fail to process header - invalid slot", function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 4;
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
    }
  });

  it("fail to process header - invalid parent header", function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = Buffer.alloc(10, 1);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it("fail to process header - proposerSlashed", function () {
    const state = generateState({slot: 5});
    state.validators.push(generateValidator({activation: 0, exit: 10, slashed: true}));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = hashTreeRoot(config.types.BeaconBlockHeader, state.latestBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
    }
  });

  it("should process block", function () {
    const state = generateState({slot: 5});
    state.validators.push(generateValidator({activation: 0, exit: 10}));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = hashTreeRoot(config.types.BeaconBlockHeader, state.latestBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    isValidProposerStub.returns(true);
    try {
      processBlockHeader(config, state, block);
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;

    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
