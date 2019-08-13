import BN from "bn.js";
import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import {getBeaconProposerIndex, getTemporaryBlockHeader} from "../../../../../../src/chain/stateTransition/util";
import {processDeposit} from "../../../../../../src/chain/stateTransition/block/operations";
import * as merkleUtil from "../../../../../../src/util/merkleTree";

import {generateState} from "../../../../../utils/state";
import {generateDeposit} from "../../../../../utils/deposit";
import {generateValidator} from "../../../../../utils/validator";
import {generateEmptyBlock} from "../../../../../utils/block";

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
      processDeposit(config, state, generateDeposit());
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process deposit - invalid deposit index', function () {
    const state = generateState({eth1DepositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    try {
      processDeposit(config, state, generateDeposit());
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
    }
  });

  it('should process deposit - new validator - invalid signature', function () {
    const state = generateState({eth1DepositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit();
    try {
      processDeposit(config, state, deposit);
    } catch (e) {
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.validators.length).to.be.equal(0);
      expect(state.balances.length).to.be.equal(0);
    }
  });

  it('should process deposit - new validator', function () {
    const state = generateState({eth1DepositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit();
    deposit.data.amount = new BN(config.params.MAX_EFFECTIVE_BALANCE);
    blsStub.verify.returns(true);
    try {
      processDeposit(config, state, deposit);
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.validators.length).to.be.equal(1);
      expect(state.balances.length).to.be.equal(1);
      expect(blsStub.verify.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should process deposit - increase deposit', function () {
    const state = generateState({eth1DepositIndex: 3});
    verifyMerkleTreeStub.returns(true);
    const deposit = generateDeposit();
    const validator = generateValidator();
    state.validators.push(validator);
    state.balances.push(new BN(0));
    deposit.data.pubkey = validator.pubkey;
    try {
      processDeposit(config, state, deposit);
      expect(verifyMerkleTreeStub.calledOnce).to.be.true;
      expect(state.balances[0].toString()).to.be.equal(deposit.data.amount.toString());
    } catch (e) {
      expect.fail(e);
    }
  });

});
