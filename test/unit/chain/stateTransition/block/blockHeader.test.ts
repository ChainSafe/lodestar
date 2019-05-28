import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {Domain, EMPTY_SIGNATURE} from "../../../../../src/constants";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../../src/chain/stateTransition/util";
import sinon from "sinon";
import bls from "@chainsafe/bls-js";
import {signingRoot} from "@chainsafe/ssz";
import {BeaconBlock, BeaconBlockHeader} from "../../../../../src/types";
import processBlockHeader from "../../../../../src/chain/stateTransition/block/blockHeader";
import {generateValidator} from "../../../../utils/validator";
import {getDomain} from "../../../../../src/chain/stateTransition/util";

describe('process block - block header', function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub, getBeaconProposeIndexStub;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('fail to process header - invalid slot', function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 4;
    try {
      processBlockHeader(state, block);
      expect.fail();
    } catch (e) {}
  });

  it('fail to process header - invalid parent header', function () {
    const state = generateState({slot: 5});
    const block = generateEmptyBlock();
    block.slot = 5;
    block.previousBlockRoot = Buffer.alloc(10, 1);
    try {
      processBlockHeader(state, block);
      expect.fail();
    } catch (e) {}
  });

  it('fail to process header - proposerSlashed', function () {
    const state = generateState({slot: 5});
    state.validatorRegistry.push(generateValidator(0, 10, true));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(state, block);
      expect.fail();
    } catch (e) {
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(state)).to.be.true;
    }
  });

  it('fail to process header - invalid signature', function () {
    const state = generateState({slot: 5});
    state.validatorRegistry.push(generateValidator(0, 10));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(state, block);
      expect.fail();
    } catch (e) {
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(state)).to.be.true;
    }
  });

  it('should process block - without signature verification', function () {
    const state = generateState({slot: 5});
    state.validatorRegistry.push(generateValidator(0, 10));
    const block = generateEmptyBlock();
    block.slot = 5;
    block.previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(state, block, false);
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(state)).to.be.true;

    } catch (e) {
      expect.fail(e.message);
    }
  });

  it('should process block - with signature verification', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator();
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({slot: 5});
    state.validatorRegistry.push(validator);
    const block = generateEmptyBlock();
    block.slot = 5;
    block.previousBlockRoot = signingRoot(state.latestBlockHeader, BeaconBlockHeader);
    block.signature = wallet.privateKey.signMessage(
      signingRoot(block, BeaconBlock),
      getDomain(state, Domain.BEACON_PROPOSER),
    ).toBytesCompressed();
    getTemporaryBlockHeaderStub.returns({
      previousBlockRoot: Buffer.alloc(10),
      slot: 5,
      signature: EMPTY_SIGNATURE,
      stateRoot: Buffer.alloc(10),
      blockBodyRoot: Buffer.alloc(10)
    });
    getBeaconProposeIndexStub.returns(0);
    try {
      processBlockHeader(state, block, false);
      expect(getTemporaryBlockHeaderStub.calledOnce).to.be.true;
      expect(getBeaconProposeIndexStub.calledOnceWith(state)).to.be.true;
    } catch (e) {
      expect.fail(e.message);
    }
  });

});
