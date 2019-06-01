import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {
  BLS_WITHDRAWAL_PREFIX_BYTE,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  MIN_DEPOSIT_AMOUNT
} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {slotToEpoch} from "../../../../../src/chain/stateTransition/util";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import BN from "bn.js";
import {generateEmptyTransfer} from "../../../../utils/transfer";
import processTransfers, {processTransfer} from "../../../../../src/chain/stateTransition/block/transfers";
import {hash} from "../../../../../src/util/crypto";
import {generateEmptyBlock} from "../../../../utils/block";

describe('process block - transfers', function () {

  const sandbox = sinon.createSandbox();

  let increaseBalanceStub, decreaseBalanceStub, getBeaconProposerIndexStub, blsStub;

  beforeEach(() => {
    increaseBalanceStub = sandbox.stub(utils, "increaseBalance");
    decreaseBalanceStub = sandbox.stub(utils, "decreaseBalance");
    getBeaconProposerIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    blsStub = {
      verify: sandbox.stub()
    };
    rewire(blsStub);
  });

  afterEach(() => {
    sandbox.restore();
    restore();
  });

  it('should fail to process transfer - balance lesser than amount', function () {
    const state = generateState({balances: [new BN(1)]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });


  it('should fail to process transfer - balance lesser than fee', function () {
    const state = generateState({balances: [new BN(1)]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(0);
    transfer.fee = new BN(2);
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process transfer - invalid slot', function () {
    const state = generateState({balances: [new BN(5)], slot: 1});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 2;
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process transfer - eligible for activation, withdrawn, or transfer', function () {
    const state = generateState({balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE))], slot: 1});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process transfer - balance over MAX_EFFECTIVE_BALANCE', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    const state = generateState({
      balances: [new BN(4)],
      slot: 1,
      validatorRegistry: [validator]
    });
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process transfer - invalid pubkey', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    const state = generateState({
      balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE))],
      slot: 1,
      validatorRegistry: [validator]
    });
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process transfer - invalid signature', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    validator.withdrawalCredentials = Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE))],
      slot: 1,
      validatorRegistry: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    blsStub.verify.returns(false);
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should fail to process transfer - sender balance is dust', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    validator.withdrawalCredentials = Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE))],
      slot: 1,
      validatorRegistry: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    getBeaconProposerIndexStub.returns(0);
    decreaseBalanceStub.callsFake((_, index) => {
      state.balances[index] = new BN(0);
    });
    blsStub.verify.returns(true);
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it('should fail to process transfer - recipient balance is dust', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    validator.withdrawalCredentials = Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE)), new BN(0)],
      slot: 1,
      validatorRegistry: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    transfer.recipient = 1;
    blsStub.verify.returns(true);
    getBeaconProposerIndexStub.returns(0);
    try {
      processTransfer(state, transfer);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
    }
  });

  it('should process transfer', function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = slotToEpoch(1);
    validator.withdrawalCredentials = Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [new BN(5).add(new BN(MAX_EFFECTIVE_BALANCE)), new BN(MIN_DEPOSIT_AMOUNT)],
      slot: 1,
      validatorRegistry: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = new BN(2);
    transfer.fee = new BN(2);
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    transfer.recipient = 1;
    blsStub.verify.returns(true);
    getBeaconProposerIndexStub.returns(0);
    try {
      processTransfer(state, transfer);
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
    } catch (e) {
      expect.fail(e);
    }
  });

  it('should  fail to process block transfers - exceeds max', function () {
    const state = generateState();
    const transfer = generateEmptyTransfer();
    const block = generateEmptyBlock();
    block.body.transfers.push(transfer);
    try {
      processTransfers(state, block);
      expect.fail();
    } catch (e) {

    }
  });

  it('should  process block transfers', function () {
    const state = generateState();
    const block = generateEmptyBlock();
    try {
      processTransfers(state, block);
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
