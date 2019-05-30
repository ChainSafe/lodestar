import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {
  Domain,
  FAR_FUTURE_EPOCH,
  MAX_VOLUNTARY_EXITS,
  PERSISTENT_COMMITTEE_PERIOD,
  SLOTS_PER_EPOCH
} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getDomain, initiateValidatorExit} from "../../../../../src/chain/stateTransition/util";
import bls from "@chainsafe/bls-js";
import {signingRoot} from "@chainsafe/ssz";
import {VoluntaryExit} from "../../../../../src/types";
import processVoluntaryExits, {processVoluntaryExit} from "../../../../../src/chain/stateTransition/block/voluntaryExits";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";
import {generateEmptyBlock} from "../../../../utils/block";

describe('process block - transfers', function () {

  const sandbox = sinon.createSandbox();

  let isActiveValidatorStub, initiateValidatorExitStub;

  beforeEach(() => {
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
    initiateValidatorExitStub = sandbox.stub(utils, "initiateValidatorExit");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail - validator not active', function () {
    const state = generateState();
    const exit = generateEmptyVoluntaryExit();
    state.validatorRegistry.push(generateValidator());
    isActiveValidatorStub.returns(false);
    try {
      processVoluntaryExit(state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - already exited', function () {
    const state = generateState();
    const exit = generateEmptyVoluntaryExit();
    state.validatorRegistry.push(generateValidator(0, 1));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - not valid', function () {
    const state = generateState({slot: 0});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = SLOTS_PER_EPOCH * 2;
    state.validatorRegistry.push(generateValidator(0, FAR_FUTURE_EPOCH));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - validator not enough active', function () {
    const state = generateState({slot: SLOTS_PER_EPOCH * 2});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    state.validatorRegistry.push(generateValidator(0, FAR_FUTURE_EPOCH));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail - invalid signature', function () {
    const state = generateState({slot: (PERSISTENT_COMMITTEE_PERIOD + 1) * SLOTS_PER_EPOCH});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    state.validatorRegistry.push(generateValidator(0, FAR_FUTURE_EPOCH));
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(state, exit);
      expect.fail();
    } catch (e) {
      expect(isActiveValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should process exit', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator(0, FAR_FUTURE_EPOCH);
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({slot: (PERSISTENT_COMMITTEE_PERIOD + 1) * SLOTS_PER_EPOCH});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    exit.signature = wallet.privateKey.signMessage(
      signingRoot(exit, VoluntaryExit),
      getDomain(state, Domain.VOLUNTARY_EXIT, exit.epoch)
    ).toBytesCompressed();
    state.validatorRegistry.push(validator);
    isActiveValidatorStub.returns(true);
    try {
      processVoluntaryExit(state, exit);
      expect(isActiveValidatorStub.calledOnce).to.be.true;
      expect(initiateValidatorExitStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should fail to process block exits - exceeds max', function () {
    const state = generateState();
    const exit = generateEmptyVoluntaryExit();
    const block = generateEmptyBlock();
    new Array({
      length: MAX_VOLUNTARY_EXITS + 1,
      mapFn: () => block.body.voluntaryExits.push(exit)
    });
    try {
      processVoluntaryExits(state, block);
      expect.fail();
    } catch (e) {

    }
  });


  it('should process block exits', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator(0, FAR_FUTURE_EPOCH);
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({slot: (PERSISTENT_COMMITTEE_PERIOD + 1) * SLOTS_PER_EPOCH});
    const exit = generateEmptyVoluntaryExit();
    exit.epoch = 0;
    exit.signature = wallet.privateKey.signMessage(
      signingRoot(exit, VoluntaryExit),
      getDomain(state, Domain.VOLUNTARY_EXIT, exit.epoch)
    ).toBytesCompressed();
    state.validatorRegistry.push(validator);
    isActiveValidatorStub.returns(true);
    const block = generateEmptyBlock();
    block.body.voluntaryExits.push(exit);
    try {
      processVoluntaryExits(state, block);
      expect(isActiveValidatorStub.calledOnce).to.be.true;
      expect(initiateValidatorExitStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
