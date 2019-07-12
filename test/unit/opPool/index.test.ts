import sinon from "sinon";
import {expect} from  "chai";
import {OpPool} from "../../../src/opPool";
import {BeaconDB} from "../../../src/db";
import {BeaconChain} from "../../../src/chain";
import {generateEmptyAttestation} from "../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../utils/voluntaryExits";
import {generateEmptyTransfer} from "../../utils/transfer";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../utils/slashings";
import {generateDeposit} from "../../utils/deposit";
import {generateEmptyBlock} from "../../utils/block";


describe("operation pool", function () {
  let sandbox = sinon.createSandbox();
  let opPool: OpPool;
  let chainStub, dbStub;

  beforeEach(()=>{
    dbStub = sandbox.createStubInstance(BeaconDB);
    chainStub = sandbox.createStubInstance(BeaconChain);
    opPool = new OpPool({}, {
      db: dbStub,
      chain: chainStub
    });
  });

  //receive
  it('should start and stop operation pool ', async function () {
    try {
      await opPool.start();
      await opPool.stop();
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should receive attestation', async function () {
    const attestation = {
      ...generateEmptyAttestation(),
    };

    dbStub.setAttestation.resolves(null);
    await opPool.receiveAttestation(attestation);
    expect(dbStub.setAttestation.calledOnce).to.be.true;
  });

  it('should receive voluntary exit', async function () {
    const voluntaryExit = generateEmptyVoluntaryExit();

    dbStub.setVoluntaryExit.resolves(null);
    await opPool.receiveVoluntaryExit(voluntaryExit);
    expect(dbStub.setVoluntaryExit.calledOnce).to.be.true;
  });

  it('should receive transfer', async function () {
    const transfer = generateEmptyTransfer();

    dbStub.setTransfer.resolves(null);
    await opPool.receiveTransfer(transfer);
    expect(dbStub.setTransfer.calledOnce).to.be.true;
  });

  it('should receive proposer slashing', async function () {
    const proposerSlashing = generateEmptyProposerSlashing();

    dbStub.setProposerSlashing.resolves(null);
    await opPool.receiveProposerSlashing(proposerSlashing);
    expect(dbStub.setProposerSlashing.calledOnce).to.be.true;
  });

  it('should receive attester slashing ', async function () {
    const attesterSlashing = generateEmptyAttesterSlashing();

    dbStub.setAttesterSlashing.resolves(null);
    await opPool.receiveAttesterSlashing(attesterSlashing);
    expect(dbStub.setAttesterSlashing.calledOnce).to.be.true;
  });

  it('should receive deposit ', async function () {
    const deposit = generateDeposit();

    dbStub.setDeposit.resolves(null);
    await opPool.receiveDeposit(0, deposit);
    expect(dbStub.setDeposit.calledOnce).to.be.true;
  });


  //get

  it('should return  attestations', async function () {
    const attestation = {
      ...generateEmptyAttestation(),
    };

    dbStub.getAttestations.resolves(attestation);
    let result = await opPool.getAttestations();
    expect(dbStub.getAttestations.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(attestation);
  });

  it('should return voluntary exits', async function () {
    const voluntaryExit = generateEmptyVoluntaryExit();

    dbStub.getVoluntaryExits.resolves(voluntaryExit);
    let result = await opPool.getVoluntaryExits();
    expect(dbStub.getVoluntaryExits.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(voluntaryExit);
  });

  it('should return transfers', async function () {
    const transfer = generateEmptyTransfer();

    dbStub.getTransfers.resolves(transfer);
    let result = await opPool.getTransfers();
    expect(dbStub.getTransfers.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(transfer);
  });

  it('should return proposer slashings', async function () {
    const proposerSlashing = generateEmptyProposerSlashing();

    dbStub.getProposerSlashings.resolves(proposerSlashing);
    let result = await opPool.getProposerSlashings();
    expect(dbStub.getProposerSlashings.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(proposerSlashing);
  });

  it('should return attester slashings ', async function () {
    const attesterSlashing = generateEmptyAttesterSlashing();

    dbStub.getAttesterSlashings.resolves(attesterSlashing);
    let result = await opPool.getAttesterSlashings();
    expect(dbStub.getAttesterSlashings.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(attesterSlashing);
  });

  it('should return deposits', async function () {
    const deposit = generateDeposit();

    dbStub.getDeposits.resolves(deposit);
    let result = await opPool.getDeposits();
    expect(dbStub.getDeposits.calledOnce).to.be.true;
    expect(result).to.be.deep.equal(deposit);
  });

  // remove

  it('should remove  operations', async function () {
    const block  = generateEmptyBlock();
    dbStub.deleteAttestations.resolves(null);
    dbStub.deleteDeposits.resolves(null);
    dbStub.deleteVoluntaryExits.resolves(null);
    dbStub.deleteProposerSlashings.resolves(null);
    dbStub.deleteAttesterSlashings.resolves(null);

    try {
      await opPool.removeOperations(block);
      expect(dbStub.deleteAttestations.calledOnce).to.be.true;
      expect(dbStub.deleteDeposits.calledOnce).to.be.true;
      expect(dbStub.deleteVoluntaryExits.calledOnce).to.be.true;
      expect(dbStub.deleteProposerSlashings.calledOnce).to.be.true;
      expect(dbStub.deleteAttesterSlashings.calledOnce).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });


});