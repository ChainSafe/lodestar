import sinon from "sinon";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";
import {signingRoot} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconBlockHeader} from "@chainsafe/eth2.0-types";
import {EMPTY_SIGNATURE} from "../../../../../src/constants";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../../src/chain/stateTransition/util";
import {processBlockHeader} from "../../../../../src/chain/stateTransition/block/blockHeader";

import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateValidator} from "../../../../utils/validator";

describe('process block - block header', function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub, getBeaconProposeIndexStub, blsStub;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('fail to process header - invalid slot', function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 4;
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it('fail to process header - invalid parent header', function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = Buffer.alloc(10, 1);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {}
  });

  it('fail to process header - proposerSlashed', function () {
    const state = generateState({slot: 5});
    state.validators.push(generateValidator({activation: 0, exit: 10, slashed: true}));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = signingRoot(state.latestBlockHeader, config.types.BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(config, state)).to.be.true;
    }
  });

  it('fail to process header - invalid signature', function () {
    const state = generateState({slot: 5});
    state.validators.push(generateValidator({activation: 0, exit: 10}));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = signingRoot(state.latestBlockHeader, config.types.BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    blsStub.verify.returns(false);
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(config, state, block);
      expect.fail();
    } catch (e) {
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(config, state)).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should process block - without signature verification', function () {
    const state = generateState({slot: 5});
    state.validators.push(generateValidator({activation: 0, exit: 10}));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = signingRoot(state.latestBlockHeader, config.types.BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(config, state, block, false);
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(config, state)).to.be.true;

    } catch (e) {
      expect.fail(e.message);
    }
  });

  it('should process block - with signature verification', function () {
    const validator = generateValidator();
    const state = generateState({slot: 5});
    state.validators.push(validator);
    const block = generateEmptyBlock();
    block.slot = 5;
    block.parentRoot = signingRoot(state.latestBlockHeader, config.types.BeaconBlockHeader);
    blsStub.verify.returns(true);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(config, state, block, true);
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(config, state)).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
