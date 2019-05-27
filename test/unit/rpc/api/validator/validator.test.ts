import sinon from "sinon";
import * as blockAssembly from "../../../../../src/chain/factory/block";
import * as stateTransitionUtils from "../../../../../src/chain/stateTransition/util";
import {getCommitteeAssignment} from "../../../../../src/chain/stateTransition/util";
import {ValidatorApi} from "../../../../../src/rpc/api/validator";
import {BeaconDB} from "../../../../../src/db/api";
import {BeaconChain} from "../../../../../src/chain";
import {OpPool} from "../../../../../src/opPool";
import {generateEmptyBlock} from "../../../../utils/block";
import {expect} from "chai";
import {generateState} from "../../../../utils/state";
import {StatefulDagLMDGHOST} from "../../../../../src/chain/forkChoice";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import * as dutyFactory from "../../../../../src/chain/factory/duties";

describe('validator rpc api', function () {

  const sandbox = sinon.createSandbox();

  let validatorApi, dbStub, chainStub, opStub, forkChoiceStub;

  beforeEach(() => {
    dbStub = sandbox.createStubInstance(BeaconDB);
    forkChoiceStub = sandbox.createStubInstance(StatefulDagLMDGHOST);
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    opStub = sandbox.createStubInstance(OpPool);
    validatorApi = new ValidatorApi({}, {chain: chainStub, db: dbStub, opPool: opStub});
  });

  afterEach(() => {
    sandbox.restore()
  });

  it('produce block', async function() {
    const assembleBlockStub = sandbox.stub(blockAssembly, 'assembleBlock');
    assembleBlockStub.resolves(generateEmptyBlock());
    const result = await validatorApi.produceBlock(1, Buffer.alloc(96, 0));
    expect(result).to.be.not.null;
    expect(
      assembleBlockStub
        .withArgs(dbStub, opStub, 1, Buffer.alloc(96, 0))
        .calledOnce
    ).to.be.true;
  });

  it('is proposer', async function() {
    const isProposerStub = sandbox.stub(stateTransitionUtils, 'isProposerAtSlot');
    const state = generateState();
    dbStub.getState.resolves(state);
    isProposerStub.returns(true);
    const result = await validatorApi.isProposer(1, 2);
    expect(result).to.be.true;
    expect(
      isProposerStub
        .withArgs(state, 2, 1)
        .calledOnce
    ).to.be.true;
  });

  it('get duties', async function() {
    const publicKey = Buffer.alloc(48, 1);
    const state = generateState();
    dbStub.getState.resolves(state);
    dbStub.getValidatorIndex.resolves(5);
    const getProposerStub = sandbox.stub(stateTransitionUtils, 'getBeaconProposerIndex');
    getProposerStub.returns(4);
    const assembleValidatorDutyStub = sandbox.stub(dutyFactory, 'assembleValidatorDuty');
    assembleValidatorDutyStub.returns(dutyFactory.generateEmptyValidatorDuty(publicKey));
    const duties = await validatorApi.getDuties([publicKey]);
    expect(duties.length).to.be.equal(1);
    expect(duties[0].committeeIndex).to.be.null;
    expect(duties[0].blockProductionSlot).to.be.null;
    expect(dbStub.getState.calledOnce).to.be.true;
    expect(dbStub.getValidatorIndex.withArgs(publicKey).calledOnce).to.be.true;
    expect(getProposerStub.withArgs(state).calledOnce).to.be.true;
    expect(assembleValidatorDutyStub.calledOnceWith(publicKey, 5, state, 4)).to.be.true;
  });

  it('get committee assignment', async function() {
    const state = generateState();
    dbStub.getState.resolves(state);
    const commiteeAssignmentStub = sandbox.stub(stateTransitionUtils, 'getCommitteeAssignment');
    commiteeAssignmentStub.returns(null);
    const result = await validatorApi.getCommitteeAssignment(1, 2);
    expect(result).to.be.null;
    expect(dbStub.getState.calledOnce).to.be.true;
    expect(commiteeAssignmentStub.withArgs(state, 2, 1));
  });

  it('produceAttestation - missing slots', async function() {
    const state = generateState({slot: 1});
    dbStub.getState.resolves(state);
    const block = generateEmptyBlock();
    dbStub.getBlock.resolves(block);
    const result = await validatorApi.produceAttestation(4, 2);
    expect(result).to.not.be.null;
    expect(dbStub.getState.calledOnce).to.be.true;
    expect(dbStub.getBlock.calledTwice).to.be.true;
  });

  it('publish block', async function() {
    const block = generateEmptyBlock();
    await validatorApi.publishBlock(block);
    expect(chainStub.receiveBlock.withArgs(block).calledOnce).to.be.true;
  });

  it('publish attestation', async function() {
    const attestation = generateEmptyAttestation();
    await validatorApi.publishAttestation(attestation);
    expect(opStub.receiveAttestation.withArgs(attestation).calledOnce).to.be.true;
  });

  it('get validator index', async function() {
    const publicKey = Buffer.alloc(48, 1);
    dbStub.getValidatorIndex.resolves(4);
    const result = await validatorApi.getIndex(publicKey);
    expect(result).to.be.equal(4);
    expect(dbStub.getValidatorIndex.withArgs(publicKey).calledOnce).to.be.true;
  });

});
