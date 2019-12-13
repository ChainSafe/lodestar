import {expect} from "chai";
import sinon from "sinon";
import * as blsModule from "@chainsafe/bls";
import {hash} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {
  FAR_FUTURE_EPOCH,
} from "../../../../../src/constants";
import * as utils from "../../../../../src/util";
import {computeEpochOfSlot} from "../../../../../src/util";
import {processTransfer} from "../../../../../src/block/operations";

import {generateEmptyTransfer} from "../../../../utils/transfer";
import {generateValidator} from "../../../../utils/validator";
import {generateState} from "../../../../utils/state";

describe("process block - transfers", function () {

  const sandbox = sinon.createSandbox();

  let increaseBalanceStub: any, decreaseBalanceStub: any, getBeaconProposerIndexStub: any, blsStub: any;

  beforeEach(() => {
    increaseBalanceStub = sandbox.stub(utils, "increaseBalance");
    decreaseBalanceStub = sandbox.stub(utils, "decreaseBalance");
    getBeaconProposerIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    blsStub = {
      verify: sandbox.stub(blsModule, "verify")
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process transfer - balance lesser than amount", function () {
    const state = generateState({balances: [1n]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });


  it("should fail to process transfer - balance lesser than fee", function () {
    const state = generateState({balances: [1n]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 0n;
    transfer.fee = 2n;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it("should fail to process transfer - invalid slot", function () {
    const state = generateState({balances: [5n], slot: 1});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 2;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it("should fail to process transfer - eligible for activation, withdrawn, or transfer", function () {
    const state = generateState({balances: [5n + config.params.MAX_EFFECTIVE_BALANCE], slot: 1});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it("should fail to process transfer - balance over MAX_EFFECTIVE_BALANCE", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    const state = generateState({
      balances: [4n],
      slot: 1,
      validators: [validator]
    });
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it("should fail to process transfer - invalid pubkey", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    const state = generateState({
      balances: [5n + BigInt(config.params.MAX_EFFECTIVE_BALANCE)],
      slot: 1,
      validators: [validator]
    });
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {

    }
  });

  it("should fail to process transfer - invalid signature", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    validator.withdrawalCredentials = Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [5n + config.params.MAX_EFFECTIVE_BALANCE],
      slot: 1,
      validators: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    blsStub.verify.returns(false);
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it("should fail to process transfer - sender balance is dust", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    validator.withdrawalCredentials = Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [5n + config.params.MAX_EFFECTIVE_BALANCE],
      slot: 1,
      validators: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    getBeaconProposerIndexStub.returns(0);
    decreaseBalanceStub.callsFake((_: any, index: any) => {
      state.balances[index] = 0n;
    });
    blsStub.verify.returns(true);
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
    }
  });

  it("should fail to process transfer - recipient balance is dust", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    validator.withdrawalCredentials = Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [5n + config.params.MAX_EFFECTIVE_BALANCE, 0n],
      slot: 1,
      validators: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    transfer.recipient = 1;
    blsStub.verify.returns(true);
    getBeaconProposerIndexStub.returns(0);
    try {
      processTransfer(config, state, transfer);
      expect.fail();
    } catch (e) {
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
    }
  });

  it("should process transfer", function () {
    const validator = generateValidator();
    validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;
    validator.withdrawableEpoch = computeEpochOfSlot(config, 1);
    validator.withdrawalCredentials = Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(validator.pubkey).slice(1)]);
    const state = generateState({
      balances: [ 5n + config.params.MAX_EFFECTIVE_BALANCE, config.params.MIN_DEPOSIT_AMOUNT],
      slot: 1,
      validators: [validator]});
    const transfer = generateEmptyTransfer();
    transfer.amount = 2n;
    transfer.fee = 2n;
    transfer.slot = 1;
    transfer.pubkey = validator.pubkey;
    transfer.recipient = 1;
    blsStub.verify.returns(true);
    getBeaconProposerIndexStub.returns(0);
    try {
      processTransfer(config, state, transfer);
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
      expect(blsStub.verify.calledOnce).to.be.true;
      expect(decreaseBalanceStub.calledOnce).to.be.true;
      expect(increaseBalanceStub.calledTwice).to.be.true;
    } catch (e) {
      expect.fail(e);
    }
  });
});
