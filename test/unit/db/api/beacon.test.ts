import sinon from "sinon";

import * as dbKeys from "../../../../src/db/schema";
import {Bucket, Key} from "../../../../src/db/schema";
import {BeaconDB} from "../../../../src/db/api";
import {LevelDbPersistance} from "../../../../src/db/persistance";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  BeaconState, Deposit,
  ProposerSlashing,
  uint64,
  VoluntaryExit
} from "../../../../src/types";
import {generateState} from "../../../utils/state";
import chai, {expect} from "chai";
import {serialize} from "@chainsafe/ssz";
import {generateEmptyBlock} from "../../../utils/block";
import BN from "bn.js";
import chaiAsPromised from 'chai-as-promised';
import {generateEmptyAttestation} from "../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../utils/voluntaryExits";
import {generateEmptyTransfer} from "../../../utils/transfer";
import {Transfer} from "../../../../src/types";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../utils/slashings";
import {generateDeposit} from "../../../utils/deposit";

chai.use(chaiAsPromised);

describe('beacon db api', function() {

  const sandbox = sinon.createSandbox();

  let encodeKeyStub, dbStub, beaconDB;

  beforeEach(() => {
    encodeKeyStub = sandbox.stub(dbKeys, 'encodeKey');
    dbStub = sandbox.createStubInstance(LevelDbPersistance);
    beaconDB = new BeaconDB({
      persistance: dbStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('get state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.state).returns('stateKey');
    dbStub.get.withArgs('stateKey').resolves(serialize(generateState(), BeaconState));
    const result = await beaconDB.getState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.state).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('stateKey').calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.state).returns('stateKey');
    await beaconDB.setState(generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.state).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('stateKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('get finalized state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).returns('stateKey');
    dbStub.get.withArgs('stateKey').resolves(serialize(generateState(), BeaconState));
    const result = await beaconDB.getFinalizedState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('stateKey').calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set finalized state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).returns('stateKey');
    await beaconDB.setFinalizedState(generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('stateKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('get justified state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).returns('stateKey');
    dbStub.get.withArgs('stateKey').resolves(serialize(generateState(), BeaconState));
    const result = await beaconDB.getJustifiedState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('stateKey').calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set justified state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).returns('stateKey');
    await beaconDB.setJustifiedState(generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).calledOnce).to.be.true;
    expect(dbStub.put.withArgs('stateKey', sinon.match.any).calledOnce).to.be.true;
  });

  it('get block', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.getBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(serialize(result, BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), BeaconBlock).toString('hex'));
  });

  it('has block - false', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns('blockId');
    dbStub.get.withArgs('blockId').resolves(null);
    const result = await beaconDB.hasBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(result).to.be.false;
  });

  it('has block - true', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.hasBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(result).to.be.true;
  });

  it('get block by slot', async function() {
    encodeKeyStub.withArgs(Bucket.mainChain, 1).returns('slot');
    dbStub.get.withArgs('slot').resolves('blockRoot');
    encodeKeyStub.withArgs(Bucket.block, 'blockRoot').returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.getBlockBySlot(1);
    expect(encodeKeyStub.withArgs(Bucket.mainChain, 1).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.block, 'blockRoot').calledOnce).to.be.true;
    expect(dbStub.get.withArgs('slot').calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(result).to.not.be.null;
  });

  it('set block', async function() {
    encodeKeyStub
      .withArgs(Bucket.block, sinon.match.any)
      .returns('blockId');
    await beaconDB.setBlock(generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(
          Bucket.block,
          sinon.match.any
        ).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('set finalized block', async function() {
    encodeKeyStub
      .withArgs(Bucket.chainInfo, Key.finalizedBlock)
      .returns('blockId');
    await beaconDB.setFinalizedBlock(generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(Bucket.chainInfo, Key.finalizedBlock).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('get finalized block', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedBlock).returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.getFinalizedBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedBlock).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(serialize(result, BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), BeaconBlock).toString('hex'));
  });

  it('set justified block', async function() {
    encodeKeyStub
      .withArgs(Bucket.chainInfo, Key.justifiedBlock)
      .returns('blockId');
    await beaconDB.setJustifiedBlock(generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(Bucket.chainInfo, Key.justifiedBlock).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('get justified block', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedBlock).returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.getJustifiedBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedBlock).calledOnce).to.be.true;
    expect(dbStub.get.withArgs('blockId').calledOnce).to.be.true;
    expect(serialize(result, BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), BeaconBlock).toString('hex'));
  });

  it('get chain head', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    dbStub.get.withArgs('chainHeightKey').resolves(serialize(10, uint64));
    encodeKeyStub.withArgs(Bucket.mainChain, new BN(10)).returns('blockRootKey');
    dbStub.get.withArgs('blockRootKey').resolves('blockroot');
    encodeKeyStub.withArgs(Bucket.block, 'blockroot').returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), BeaconBlock));
    const result = await beaconDB.getChainHead();
    expect(serialize(result, BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), BeaconBlock).toString('hex'));
  });

  it('set chain head', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    beaconDB.getBlock = sandbox.stub().resolves(generateEmptyBlock());
    await beaconDB.setChainHead(generateState(), generateEmptyBlock());
    expect(beaconDB.getBlock.calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.mainChain, 0).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.state).calledOnce).to.be.true;
    expect(dbStub.batchPut.withArgs(sinon.match.array).calledOnce).to.be.true;
  });

  it('fail to set chain head (block missing)', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    beaconDB.getBlock = sandbox.stub().resolves(null);
    await expect(beaconDB.setChainHead(generateState(), generateEmptyBlock()))
      .to.be.rejectedWith("block should be saved already");
  });

  it('test get attestation', async function() {
    encodeKeyStub.withArgs(Bucket.attestation, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.attestation + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), Attestation)]);
    const result = await beaconDB.getAttestations();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.attestation, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.attestation + 1, Buffer.alloc(0)).calledOnce).to.be.true;
  });

  it('test set attestation', async function() {
    encodeKeyStub.returns('attestationKey');
    dbStub.put.resolves({});
    await beaconDB.setAttestation(generateEmptyAttestation());
    expect(
      dbStub.put.withArgs(
        "attestationKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.attestation, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete attestation', async function() {
    encodeKeyStub.returns('attestationKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteAttestations([generateEmptyAttestation(), generateEmptyAttestation()]);
    expect(encodeKeyStub.withArgs(Bucket.attestation, sinon.match.any).calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

  it('test get voluntary exists', async function() {
    encodeKeyStub.withArgs(Bucket.exit, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.exit + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyVoluntaryExit(), VoluntaryExit)]);
    const result = await beaconDB.getVoluntaryExits();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.exit, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.exit + 1, Buffer.alloc(0)).calledOnce).to.be.true;
  });

  it('test set voluntary exit', async function() {
    encodeKeyStub.returns('voluntaryExitKey');
    dbStub.put.resolves({});
    await beaconDB.setVoluntaryExit(generateEmptyVoluntaryExit());
    expect(
      dbStub.put.withArgs(
        "voluntaryExitKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.exit, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete voluntary exists', async function() {
    encodeKeyStub.returns('voluntaryExitKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteVoluntaryExits([generateEmptyVoluntaryExit(), generateEmptyVoluntaryExit()]);
    expect(encodeKeyStub.withArgs(Bucket.exit, sinon.match.any).calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

  it('test get transfers', async function() {
    encodeKeyStub.withArgs(Bucket.transfer, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.transfer + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyTransfer(), Transfer)]);
    const result = await beaconDB.getTransfers();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.transfer, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.transfer + 1, Buffer.alloc(0)).calledOnce).to.be.true;
  });

  it('test set transfer', async function() {
    encodeKeyStub.returns('transferKey');
    dbStub.put.resolves({});
    await beaconDB.setTransfer(generateEmptyTransfer());
    expect(
      dbStub.put.withArgs(
        "transferKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.transfer, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete voluntary exists', async function() {
    encodeKeyStub.returns('transferKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteTransfers([generateEmptyTransfer(), generateEmptyTransfer()]);
    expect(encodeKeyStub.withArgs(Bucket.transfer, sinon.match.any).calledTwice).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

  it('test get proposer slashings', async function() {
    encodeKeyStub.withArgs(Bucket.proposerSlashing, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.proposerSlashing + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyProposerSlashing(), ProposerSlashing)]);
    const result = await beaconDB.getProposerSlashings();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposerSlashing, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(
      encodeKeyStub.withArgs(Bucket.proposerSlashing + 1, Buffer.alloc(0)).calledOnce
    ).to.be.true;
  });

  it('test set proposer slashings', async function() {
    encodeKeyStub.returns('proposerSlashingKey');
    dbStub.put.resolves({});
    await beaconDB.setProposerSlashing(generateEmptyProposerSlashing());
    expect(
      dbStub.put.withArgs(
        "proposerSlashingKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.proposerSlashing, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete proposer slashings', async function() {
    encodeKeyStub.returns('proposerSlashingKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteProposerSlashings(
      [generateEmptyProposerSlashing(), generateEmptyProposerSlashing()]
    );
    expect(
      encodeKeyStub.withArgs(Bucket.proposerSlashing, sinon.match.any).calledTwice
    ).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

  it('test get attester slashings', async function() {
    encodeKeyStub.withArgs(Bucket.attesterSlashing, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.attesterSlashing + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyAttesterSlashing(), AttesterSlashing)]);
    const result = await beaconDB.getAttesterSlashings();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.attesterSlashing, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(
      encodeKeyStub.withArgs(Bucket.attesterSlashing + 1, Buffer.alloc(0)).calledOnce
    ).to.be.true;
  });

  it('test set attester slashings', async function() {
    encodeKeyStub.returns('attesterSlashingKey');
    dbStub.put.resolves({});
    await beaconDB.setAttesterSlashing(generateEmptyAttesterSlashing());
    expect(
      dbStub.put.withArgs(
        "attesterSlashingKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.attesterSlashing, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete attester slashings', async function() {
    encodeKeyStub.returns('attesterSlashingKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteAttesterSlashings(
      [generateEmptyAttesterSlashing(), generateEmptyAttesterSlashing()]
    );
    expect(
      encodeKeyStub.withArgs(Bucket.attesterSlashing, sinon.match.any).calledTwice
    ).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

  it('test get genesis deposits', async function() {
    encodeKeyStub.withArgs(Bucket.genesisDeposit, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.genesisDeposit + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateDeposit(1), Deposit)]);
    const result = await beaconDB.getGenesisDeposits();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.genesisDeposit, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(
      encodeKeyStub.withArgs(Bucket.genesisDeposit + 1, Buffer.alloc(0)).calledOnce
    ).to.be.true;
  });

  it('test set genesis deposits', async function() {
    encodeKeyStub.returns('genesisDepositKey');
    dbStub.put.resolves({});
    await beaconDB.setGenesisDeposit(generateDeposit(2));
    expect(
      dbStub.put.withArgs(
        "genesisDepositKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.genesisDeposit, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete genesis deposits', async function() {
    encodeKeyStub.returns('genesisDepositKey');
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteGenesisDeposits(
      [generateDeposit(1), generateDeposit(2)]
    );
    expect(
      encodeKeyStub.withArgs(Bucket.genesisDeposit, sinon.match.any).calledTwice
    ).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(
        sinon.match.array
      ).calledOnce
    ).to.be.true;
  });

});
