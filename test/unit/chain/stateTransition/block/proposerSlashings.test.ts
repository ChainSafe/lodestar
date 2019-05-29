import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {Domain, MAX_PROPOSER_SLASHINGS, SLOTS_PER_EPOCH} from "../../../../../src/constants";
import {generateValidator} from "../../../../utils/validator";
import {generateEmptyProposerSlashing} from "../../../../utils/slashings";
import processProposerSlashings, {processProposerSlashing} from "../../../../../src/chain/stateTransition/block/proposerSlashings";
import * as utils from "../../../../../src/chain/stateTransition/util";
import {getDomainFromFork, slotToEpoch} from "../../../../../src/chain/stateTransition/util";
import bls from "@chainsafe/bls-js";
import {signingRoot} from "@chainsafe/ssz";
import {BeaconBlockHeader} from "../../../../../src/types";
import {generateEmptyBlock} from "../../../../utils/block";

describe('process block - proposer slashings', function () {

  const sandbox = sinon.createSandbox();

  let isSlashableValidatorStub, slashValidatorStub;

  beforeEach(() => {
    isSlashableValidatorStub = sandbox.stub(utils, "isSlashableValidator");
    slashValidatorStub = sandbox.stub(utils, "slashValidator");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail to process - different epoch', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = SLOTS_PER_EPOCH + 1;
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it('should fail to process - same headers', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = proposerSlashing.header1.slot;
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
    }
  });

  it('should fail to process - same headers', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(false);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process - invalid signature 1', function () {
    const state = generateState({validatorRegistry: [generateValidator()]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process - invalid signature 2', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator();
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({validatorRegistry: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    wallet.privateKey.signMessage(
      signingRoot(proposerSlashing.header1, BeaconBlockHeader),
      getDomainFromFork(state.fork, Domain.BEACON_PROPOSER, slotToEpoch(proposerSlashing.header1.slot))
    );
    try {
      processProposerSlashing(state, proposerSlashing);
      expect.fail();
    } catch (e) {
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
    }
  });

  it('should process', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator();
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({validatorRegistry: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    proposerSlashing.header1.signature = wallet.privateKey.signMessage(
      signingRoot(proposerSlashing.header1, BeaconBlockHeader),
      getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header1.slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    proposerSlashing.header2.signature = wallet.privateKey.signMessage(
      signingRoot(proposerSlashing.header2, BeaconBlockHeader),
      getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header2.slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    try {
      processProposerSlashing(state, proposerSlashing);
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
      expect(slashValidatorStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should fail to process from block - exceeds maximum', function () {
    const state = generateState();
    const block = generateEmptyBlock();
    new Array({
      length: MAX_PROPOSER_SLASHINGS + 1,
      mapFn: () => {
        return generateEmptyProposerSlashing();
      }
    });
    try {
      processProposerSlashings(state, block);
      expect.fail();
    } catch (e) {

    }
  });

  it('should process from block', function () {
    const wallet = bls.generateKeyPair();
    const validator = generateValidator();
    validator.pubkey = wallet.publicKey.toBytesCompressed();
    const state = generateState({validatorRegistry: [validator]});
    const proposerSlashing = generateEmptyProposerSlashing();
    proposerSlashing.header1.slot = 1;
    proposerSlashing.header2.slot = 2;
    isSlashableValidatorStub.returns(true);
    proposerSlashing.header1.signature = wallet.privateKey.signMessage(
      signingRoot(proposerSlashing.header1, BeaconBlockHeader),
      getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header1.slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    proposerSlashing.header2.signature = wallet.privateKey.signMessage(
      signingRoot(proposerSlashing.header2, BeaconBlockHeader),
      getDomainFromFork(state.fork, slotToEpoch(proposerSlashing.header2.slot), Domain.BEACON_PROPOSER)
    ).toBytesCompressed();
    const block = generateEmptyBlock();
    block.body.proposerSlashings.push(proposerSlashing);
    try {
      processProposerSlashings(state, block);
      expect(isSlashableValidatorStub.calledOnce).to.be.true;
      expect(slashValidatorStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
