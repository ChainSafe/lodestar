import sinon from "sinon";
import {expect} from "chai";
import {describe} from "mocha";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as blockAssembly from "../../../../../../src/chain/factory/block";
import * as stateTransitionUtils from "../../../../../../src/chain/stateTransition/util";
import {getCommitteeAssignment} from "../../../../../../src/chain/stateTransition/util";
import {ValidatorApi} from "../../../../../../src/api/rpc/api/validator";
import {BeaconDb} from "../../../../../../src/db/api";
import {BeaconChain} from "../../../../../../src/chain";
import {AttestationOperations, OpPool} from "../../../../../../src/opPool";
import {generateEmptyBlock} from "../../../../../utils/block";
import {generateState} from "../../../../../utils/state";
import {StatefulDagLMDGHOST} from "../../../../../../src/chain/forkChoice";
import * as dutyFactory from "../../../../../../src/chain/factory/duties";
import {EthersEth1Notifier} from "../../../../../../src/eth1";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {BlockRepository, StateRepository} from "../../../../../../src/db/api/beacon/repositories";
import * as validatorImpl from "../../../../../../src/api/impl/validator";
import {Keypair} from "@chainsafe/bls";

describe('validator rpc api', function () {

  const sandbox = sinon.createSandbox();

  let validatorApi, dbStub, chainStub, opStub, forkChoiceStub, eth1Stub, getDutiesStub;

  beforeEach(() => {
    dbStub = sandbox.createStubInstance(BeaconDb);
    dbStub.state =sandbox.createStubInstance(StateRepository);
    dbStub.block =sandbox.createStubInstance(BlockRepository);
    eth1Stub = sandbox.createStubInstance(EthersEth1Notifier);
    forkChoiceStub = sandbox.createStubInstance(StatefulDagLMDGHOST);
    getDutiesStub = sandbox.stub(validatorImpl, "getValidatorDuties");
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = forkChoiceStub;
    opStub = sandbox.createStubInstance(OpPool);
    opStub.attestations = sandbox.createStubInstance(AttestationOperations);
    validatorApi = new ValidatorApi({}, {config, chain: chainStub, db: dbStub, opPool: opStub, eth1: eth1Stub});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('produce block', async function() {
    const assembleBlockStub = sandbox.stub(blockAssembly, 'assembleBlock');
    assembleBlockStub.resolves(generateEmptyBlock());
    const result = await validatorApi.produceBlock(1, Buffer.alloc(96, 0));
    expect(result).to.be.not.null;
    expect(
      assembleBlockStub
        .withArgs(config, dbStub, opStub, eth1Stub, 1, Buffer.alloc(96, 0))
        .calledOnce
    ).to.be.true;
  });

  it('get duties', async function() {
    const publicKey = Buffer.alloc(48, 1);
    getDutiesStub.resolves([dutyFactory.generateEmptyValidatorDuty(publicKey)]);
    const duties = await validatorApi.getDuties([publicKey], 2);
    expect(duties.length).to.be.equal(1);
    expect(duties[0].committeeIndex).to.be.null;
    expect(duties[0].blockProposalSlot).to.be.null;
    expect(getDutiesStub.calledOnce).to.be.true;
  });

  it('produceAttestation - missing slots', async function() {
    const state = generateState({slot: 1});
    dbStub.state.getLatest.resolves(state);
    const block = generateEmptyBlock();
    dbStub.block.get.resolves(block);
    dbStub.getValidatorIndex.resolves(0);
    const result = await validatorApi.produceAttestation(Keypair.generate().publicKey.toBytesCompressed(), false, 4, 2);
    expect(result).to.not.be.null;
    expect(dbStub.state.getLatest.calledOnce).to.be.true;
    expect(dbStub.block.get.calledTwice).to.be.true;
  });

  it('publish block', async function() {
    const block = generateEmptyBlock();
    await validatorApi.publishBlock(block);
    expect(chainStub.receiveBlock.withArgs(block).calledOnce).to.be.true;
  });

  it('publish attestation', async function() {
    const attestation = generateEmptyAttestation();
    await validatorApi.publishAttestation(attestation);
    expect(opStub.attestations.receive.withArgs(attestation).calledOnce).to.be.true;
  });

});
