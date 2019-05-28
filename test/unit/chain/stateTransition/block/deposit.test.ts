import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../../src/chain/stateTransition/util";
import * as merkleUtil from "../../../../../src/util/merkleTree";
import bls from "@chainsafe/bls-js";
import sinon from "sinon";
import {processDeposit} from "../../../../../src/chain/stateTransition/block/deposits";
import {generateDeposit} from "../../../../utils/deposit";
import {signingRoot} from "@chainsafe/ssz";
import {DepositData} from "../../../../../src/types";
import {getDomain} from "../../../../../src/chain/stateTransition/util";
import {Domain} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import BN from "bn.js";

describe('process block - attestation', function () {

  const sandbox = sinon.createSandbox();

  let getTemporaryBlockHeaderStub, getBeaconProposeIndexStub, verifyMerkleTreeStub, blsStub;

  beforeEach(() => {
    getTemporaryBlockHeaderStub = sandbox.stub(utils, "getTemporaryBlockHeader");
    getBeaconProposeIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    verifyMerkleTreeStub = sandbox.stub(merkleUtil, 'verifyMerkleBranch');
  });

  afterEach(() => {
    sandbox.restore();
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
    const wallet = bls.generateKeyPair();
    const state = generateState({depositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit(3);
    deposit.data.pubkey = wallet.publicKey.toBytesCompressed();
    deposit.data.signature = wallet.privateKey.signMessage(
      signingRoot(deposit.data, DepositData),
      getDomain(state, Domain.DEPOSIT)
    ).toBytesCompressed();
    try {
      processDeposit(state, deposit);
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.validatorRegistry.length).to.be.equal(1);
      expect(state.balances.length).to.be.equal(1);
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
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.balances[0]).to.be.equal(deposit.data.amount);
    }
  });



});
