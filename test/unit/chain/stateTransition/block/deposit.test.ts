import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../../src/chain/stateTransition/util";
import * as merkleUtil from "../../../../../src/util/merkleTree";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import processDeposits, {processDeposit} from "../../../../../src/chain/stateTransition/block/deposits";
import {generateDeposit} from "../../../../utils/deposit";
import {MAX_EFFECTIVE_BALANCE} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import BN from "bn.js";
import {generateEmptyBlock} from "../../../../utils/block";

describe('process block - deposits', function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub, getBeaconProposeIndexStub, verifyMerkleTreeStub, blsStub;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    verifyMerkleTreeStub = sandbox.stub(merkleUtil, 'verifyMerkleBranch');
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('should fail to process deposit - invalid merkle branch', function () {
    const state = generateState();
    verifyMerkleTreeStub.returns(false);
    try {
      processDeposit(state, generateDeposit(0));
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process deposit - invalid deposit index', function () {
    const state = generateState({depositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    try {
      processDeposit(state, generateDeposit(0));
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
    }
  });

  it('should process deposit - new validator - invalid signature', function () {
    const state = generateState({depositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit(3);
    try {
      processDeposit(state, deposit);
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.validatorRegistry.length).to.be.equal(0);
      expect(state.balances.length).to.be.equal(0);
    }
  });

  it('should process deposit - new validator', function () {
    const state = generateState({depositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit(3);
    deposit.data.amount = new BN(MAX_EFFECTIVE_BALANCE);
    blsStub.verify.returns(true);
    try {
      processDeposit(state, deposit);
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.validatorRegistry.length).to.be.equal(1);
      expect(state.balances.length).to.be.equal(1);
      expect(blsStub.verify.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should process deposit - increase deposit', function () {
    const state = generateState({depositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit(3);
    const validator = generateValidator();
    state.validatorRegistry.push(validator);
    state.balances.push(new BN(0));
    deposit.data.pubkey = validator.pubkey;
    try {
      processDeposit(state, deposit);
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.balances[0].toString()).to.be.equal(deposit.data.amount.toString());
    } catch (e) {
      expect.fail(e);
    }
  });

  it('should fail process deposit from blocks - missing deposits', function () {
    const state = generateState({depositIndex: 3});
    state.latestEth1Data.depositCount = 5;
    const deposit = generateDeposit(3);
    const block = generateEmptyBlock();
    block.body.deposits.push(deposit);
    try {
      processDeposits(state, block);
    } catch (e) {

    }
  });

  it('should process deposit from blocks', function () {
    const state = generateState({depositIndex: 3});
    state.latestEth1Data.depositCount = 4;
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit(3);
    const validator = generateValidator();
    state.validatorRegistry.push(validator);
    state.balances.push(new BN(0));
    deposit.data.pubkey = validator.pubkey;
    const block = generateEmptyBlock();
    block.body.deposits.push(deposit);
    try {
      processDeposits(state, block);
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.balances[0].toString()).to.be.equal(deposit.data.amount.toString());
    } catch (e) {
      expect.fail(e);
    }
  });



});
