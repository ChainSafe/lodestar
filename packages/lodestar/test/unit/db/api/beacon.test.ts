import sinon from "sinon";
import * as dbKeys from "../../../../src/db/schema";
import {Bucket, Key} from "../../../../src/db/schema";
import {BeaconDB} from "../../../../src/db/api";
import {LevelDbController} from "../../../../src/db/controller";
import {generateState} from "../../../utils/state";
import chai, {expect} from "chai";
import {serialize} from "@chainsafe/ssz";
import {generateEmptyBlock} from "../../../utils/block";
import BN from "bn.js";
import chaiAsPromised from 'chai-as-promised';
import {generateEmptyAttestation} from "../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../utils/voluntaryExits";
import {generateEmptyTransfer} from "../../../utils/transfer";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../utils/slashings";
import {generateDeposit} from "../../../utils/deposit";
import {ProgressiveMerkleTree} from "../../../../src/util/merkleTree/merkleTree";
import {createIBeaconConfig} from "../../../../src/config";
import * as mainnetParams from "../../../../src/params/presets/mainnet";

chai.use(chaiAsPromised);

describe('beacon db api', function() {

  const sandbox = sinon.createSandbox();

  let config = createIBeaconConfig(mainnetParams);
  const objKey = Buffer.alloc(32, 10);
  const objRoot = Buffer.alloc(32, 11);

  let encodeKeyStub, dbStub, beaconDB;

  beforeEach(() => {
    encodeKeyStub = sandbox.stub(dbKeys, 'encodeKey');
    dbStub = sandbox.createStubInstance(LevelDbController);
    beaconDB = new BeaconDB({
      config,
      controller: dbStub
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('get latest state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.latestState).returns(objKey);
    encodeKeyStub.withArgs(Bucket.state, objRoot).returns(objRoot);
    dbStub.get.withArgs(objKey).resolves(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateState(), config.types.BeaconState));
    const result = await beaconDB.getLatestState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.latestState).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objKey).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set latest state root', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.latestState).returns(objKey);
    await beaconDB.setLatestStateRoot(objKey, generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.latestState).calledOnce).to.be.true;
    expect(dbStub.put.withArgs(objKey, sinon.match.any).calledOnce).to.be.true;
  });

  it('get finalized state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).returns(objKey);
    encodeKeyStub.withArgs(Bucket.state, objRoot).returns(objRoot);
    dbStub.get.withArgs(objKey).resolves(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateState(), config.types.BeaconState));
    const result = await beaconDB.getFinalizedState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objKey).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set finalized state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).returns(objKey);
    await beaconDB.setFinalizedStateRoot(objKey, generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedState).calledOnce).to.be.true;
    expect(dbStub.put.withArgs(objKey, sinon.match.any).calledOnce).to.be.true;
  });

  it('get justified state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).returns(objKey);
    encodeKeyStub.withArgs(Bucket.state, objRoot).returns(objRoot);
    dbStub.get.withArgs(objKey).resolves(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateState(), config.types.BeaconState));
    const result = await beaconDB.getJustifiedState();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objKey).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(result.slot)
      .to.be.equal(generateState().slot);
  });

  it('set justified state', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).returns(objKey);
    await beaconDB.setJustifiedStateRoot(objKey, generateState());
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedState).calledOnce).to.be.true;
    expect(dbStub.put.withArgs(objKey, sinon.match.any).calledOnce).to.be.true;
  });

  it('get block', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    const result = await beaconDB.getBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(serialize(result, config.types.BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), config.types.BeaconBlock).toString('hex'));
  });

  it('has block - false', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns(objRoot);
    dbStub.get.withArgs(objRoot).resolves(null);
    const result = await beaconDB.hasBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(result).to.be.false;
  });

  it('has block - true', async function() {
    encodeKeyStub.withArgs(Bucket.block, sinon.match.any).returns(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    const result = await beaconDB.hasBlock('blockHash');
    expect(encodeKeyStub.withArgs(Bucket.block, sinon.match.any).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(result).to.be.true;
  });

  it('get block by slot', async function() {
    encodeKeyStub.withArgs(Bucket.mainChain, 1).returns('slot');
    dbStub.get.withArgs('slot').resolves('blockRoot');
    encodeKeyStub.withArgs(Bucket.block, 'blockRoot').returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
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
    await beaconDB.setBlock(objRoot, generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(
          Bucket.block,
          sinon.match.any
        ).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('set finalized block root', async function() {
    encodeKeyStub
      .withArgs(Bucket.chainInfo, Key.finalizedBlock)
      .returns('blockId');
    await beaconDB.setFinalizedBlockRoot(objRoot, generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(Bucket.chainInfo, Key.finalizedBlock).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('get finalized block', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedBlock).returns(objKey);
    encodeKeyStub.withArgs(Bucket.block, objRoot).returns(objRoot);
    dbStub.get.withArgs(objKey).resolves(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    const result = await beaconDB.getFinalizedBlock();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.finalizedBlock).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objKey).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(serialize(result, config.types.BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), config.types.BeaconBlock).toString('hex'));
  });

  it('set justified block root', async function() {
    encodeKeyStub
      .withArgs(Bucket.chainInfo, Key.justifiedBlock)
      .returns('blockId');
    await beaconDB.setJustifiedBlockRoot(objRoot, generateEmptyBlock());
    expect(
      encodeKeyStub
        .withArgs(Bucket.chainInfo, Key.justifiedBlock).calledOnce
    ).to.be.true;
    expect(dbStub.put.withArgs('blockId', sinon.match.any).calledOnce).to.be.true;
  });

  it('get justified block', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedBlock).returns(objKey);
    encodeKeyStub.withArgs(Bucket.block, objRoot).returns(objRoot);
    dbStub.get.withArgs(objKey).resolves(objRoot);
    dbStub.get.withArgs(objRoot).resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    const result = await beaconDB.getJustifiedBlock();
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.justifiedBlock).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objKey).calledOnce).to.be.true;
    expect(dbStub.get.withArgs(objRoot).calledOnce).to.be.true;
    expect(serialize(result, config.types.BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), config.types.BeaconBlock).toString('hex'));
  });

  it('get chain head', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    dbStub.get.withArgs('chainHeightKey').resolves(serialize(10, config.types.uint64));
    encodeKeyStub.withArgs(Bucket.mainChain, new BN(10)).returns('blockRootKey');
    dbStub.get.withArgs('blockRootKey').resolves('blockroot');
    encodeKeyStub.withArgs(Bucket.block, 'blockroot').returns('blockId');
    dbStub.get.withArgs('blockId').resolves(serialize(generateEmptyBlock(), config.types.BeaconBlock));
    const result = await beaconDB.getChainHead();
    expect(serialize(result, config.types.BeaconBlock).toString('hex'))
      .to.be.equal(serialize(generateEmptyBlock(), config.types.BeaconBlock).toString('hex'));
  });

  it('set chain head', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    beaconDB.getBlock = sandbox.stub().resolves(generateEmptyBlock());
    const block = generateEmptyBlock();
    block.stateRoot = objRoot;
    await beaconDB.setChainHeadRoots(objRoot, objRoot, block, generateState());
    expect(encodeKeyStub.withArgs(Bucket.mainChain, 0).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).calledOnce).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.chainInfo, Key.latestState).calledOnce).to.be.true;
    expect(dbStub.batchPut.withArgs(sinon.match.array).calledOnce).to.be.true;
  });

  it('fail to set chain head (block missing)', async function() {
    encodeKeyStub.withArgs(Bucket.chainInfo, Key.chainHeight).returns('chainHeightKey');
    beaconDB.getBlock = sandbox.stub().resolves(null);
    const block = generateEmptyBlock();
    block.stateRoot = objRoot;
    await expect(beaconDB.setChainHeadRoots(objRoot, objRoot, null, generateState()))
      .to.be.rejectedWith("unknown block root");
  });

  it('test get attestation', async function() {
    encodeKeyStub.withArgs(Bucket.attestation, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.attestation + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateEmptyAttestation(), config.types.Attestation)]);
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
    dbStub.search.resolves([serialize(generateEmptyVoluntaryExit(), config.types.VoluntaryExit)]);
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
    dbStub.search.resolves([serialize(generateEmptyTransfer(), config.types.Transfer)]);
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

  it('test delete transfers', async function() {
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
    dbStub.search.resolves([serialize(generateEmptyProposerSlashing(), config.types.ProposerSlashing)]);
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
    dbStub.search.resolves([serialize(generateEmptyAttesterSlashing(), config.types.AttesterSlashing)]);
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

  it('test get deposits', async function() {
    encodeKeyStub.withArgs(Bucket.deposit, Buffer.alloc(0)).returns('lower');
    encodeKeyStub.withArgs(Bucket.deposit + 1, Buffer.alloc(0)).returns('higher');
    dbStub.search.resolves([serialize(generateDeposit(), config.types.Deposit)]);
    const result = await beaconDB.getDeposits();
    expect(result.length).to.be.equal(1);
    expect(
      dbStub.search.withArgs(
        sinon.match.has('lt', 'higher')
          .and(sinon.match.has('gt', 'lower'))
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.deposit, Buffer.alloc(0)).calledOnce).to.be.true;
    expect(
      encodeKeyStub.withArgs(Bucket.deposit + 1, Buffer.alloc(0)).calledOnce
    ).to.be.true;
  });

  it('test set deposits', async function() {
    encodeKeyStub.returns('genesisDepositKey');
    dbStub.put.resolves({});
    await beaconDB.setDeposit(1, generateDeposit());
    expect(
      dbStub.put.withArgs(
        "genesisDepositKey",
        sinon.match.any
      ).calledOnce
    ).to.be.true;
    expect(encodeKeyStub.withArgs(Bucket.deposit, sinon.match.any).calledOnce).to.be.true;
  });

  it('test delete deposits', async function() {
    encodeKeyStub.returns('genesisDepositKey');
    let argForBatchDelete = ['genesisDepositKey','genesisDepositKey'];
    dbStub.batchDelete.resolves({});
    await beaconDB.deleteDeposits(2);
    expect(
      encodeKeyStub.withArgs(Bucket.deposit, sinon.match.any).calledTwice
    ).to.be.true;
    expect(
      dbStub.batchDelete.withArgs(argForBatchDelete).calledOnce
    ).to.be.true;
  });

  it('store merkle tree', async function() {
    encodeKeyStub.returns('merkleTreeKey');
    dbStub.put.resolves();
    const index = 1;
    await beaconDB.setMerkleTree(index, ProgressiveMerkleTree.empty(5));
    expect(encodeKeyStub.calledOnceWith(Bucket.merkleTree, index)).to.be.true;
    expect(dbStub.put.calledOnceWith('merkleTreeKey', sinon.match.any)).to.be.true;
  });

  it('get merkle tree', async function() {
    encodeKeyStub.returns('merkleTreeKey');
    dbStub.get.resolves(ProgressiveMerkleTree.empty(5).serialize());
    const index = 1;
    const tree = await beaconDB.getMerkleTree(index);
    expect(encodeKeyStub.calledOnceWith(Bucket.merkleTree, index)).to.be.true;
    expect(dbStub.get.calledOnceWith('merkleTreeKey')).to.be.true;
    expect(tree).to.not.be.null;
  });

  it('get merkle not found', async function() {
    encodeKeyStub.returns('merkleTreeKey');
    dbStub.get.resolves(null);
    const index = 1;
    const tree = await beaconDB.getMerkleTree(index);
    expect(encodeKeyStub.calledOnceWith(Bucket.merkleTree, index)).to.be.true;
    expect(dbStub.get.calledOnceWith('merkleTreeKey')).to.be.true;
    expect(tree).to.be.null;
  });

});
