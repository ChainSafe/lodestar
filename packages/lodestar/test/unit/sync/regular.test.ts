import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import * as attestationUtils from "@chainsafe/eth2.0-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/eth2.0-state-transition/lib/util/validatorStatus";

import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {AttestationOperations, OpPool, VoluntaryExitOperations} from "../../../src/opPool";
import {WinstonLogger} from "../../../src/logger";
import {RegularSync} from "../../../src/sync/regular";
import {generateState} from "../../utils/state";
import {generateEmptyBlock} from "../../utils/block";
import {generateEmptyAttestation, generateEmptyVoluntaryExit} from "../../utils/attestation";
import {AttestationRepository, BlockRepository, StateRepository} from "../../../src/db/api/beacon/repositories";
import {VoluntaryExitRepository, ProposerSlashingRepository, AttesterSlashingRepository} from "../../../lib/db/api/beacon/repositories";
import {generateEmptyProposerSlashing, generateEmptyAttesterSlashing} from "@chainsafe/eth2.0-state-transition/test/utils/slashings";
import {ProposerSlashingOperations, AttesterSlashingOperations} from "../../../lib/opPool";

describe("syncing", function () {
  let sandbox = sinon.createSandbox();
  let regularSync: RegularSync;
  let chainStub: any, networkStub: any, dbStub: any, opPoolStub: any, logger: any, isValidIndexedAttestationStub: any,
  isValidVoluntaryExitStub: any, isValidProposerSlashingStub: any, isValidAttesterSlashingStub: any;

  beforeEach(() => {
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    isValidVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    chainStub = sandbox.createStubInstance(BeaconChain);
    networkStub = sandbox.createStubInstance(Libp2pNetwork);
    dbStub = {
      block: sandbox.createStubInstance(BlockRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      voluntaryExit: sandbox.createStubInstance(VoluntaryExitRepository),
      proposerSlashing: sandbox.createStubInstance(ProposerSlashingRepository),
      attesterSlashing: sandbox.createStubInstance(AttesterSlashingRepository),
      state: sandbox.createStubInstance(StateRepository),
    };
    opPoolStub = sandbox.createStubInstance(OpPool);
    opPoolStub.voluntaryExits = sandbox.createStubInstance(VoluntaryExitOperations);
    opPoolStub.proposerSlashings = sandbox.createStubInstance(ProposerSlashingOperations);
    opPoolStub.attesterSlashings = sandbox.createStubInstance(AttesterSlashingOperations);
    logger = new WinstonLogger();
    logger.silent = true;
    regularSync = new RegularSync({}, {
      config,
      db: dbStub,
      chain: chainStub,
      network: networkStub,
      opPool: opPoolStub,
      logger: logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });


  it('should able to receive block', async function () {
    let block = generateEmptyBlock();
    dbStub.block.has.resolves(false);
    chainStub.receiveBlock.resolves(0);
    try {
      await regularSync.receiveBlock(block);
      expect(chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }

  });

  it('should skip attestation - already exists', async function () {
    let attestation = generateEmptyAttestation();
    dbStub.attestation.has.resolves(true);
    try {
      await regularSync.receiveAttestation(attestation);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should skip attestation - too old', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 1;
    dbStub.attestation.has.resolves(false);
    dbStub.state.getLatest.resolves(state);
    try {
      await regularSync.receiveAttestation(attestation);
    }catch (e) {
      expect.fail(e.stack);
    }

  });
  it('should receive attestation', async function () {
    let attestation = generateEmptyAttestation();
    let state = generateState();
    state.finalizedCheckpoint.epoch = 1;
    attestation.data.target.epoch = 2;
    dbStub.attestation.has.resolves(false);
    dbStub.state.getLatest.resolves(state);
    opPoolStub.attestations = new AttestationOperations(dbStub.attestation, {config});
    dbStub.attestation.setUnderRoot.resolves(0);
    chainStub.receiveAttestation.resolves(0);
    try {
      await regularSync.receiveAttestation(attestation);
      expect(chainStub.receiveAttestation.calledOnceWith(attestation)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it('should skip committee attestation - incorrect subnet', async function () {
    let attestation = generateEmptyAttestation();
    await regularSync.receiveCommitteeAttestation({attestation, subnet: 10});
    expect(chainStub.receiveAttestation.calledOnce).to.be.false;
  });

  it('should skip committee attestation - not unaggregated', async function () {
    let attestation = generateEmptyAttestation();
    await regularSync.receiveCommitteeAttestation({attestation, subnet: 0});
    expect(chainStub.receiveAttestation.calledOnce).to.be.false;
  });

  it('should skip committee attestation - incorrect slot', async function () {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    let state = generateState();
    // Jan 01 2019
    state.genesisTime = 1546300800;
    dbStub.state.getLatest.resolves(state);
    await regularSync.receiveCommitteeAttestation({attestation, subnet: 0});
    expect(chainStub.receiveAttestation.calledOnce).to.be.false;
  });

  it('should skip committee attestation - invalid signature', async function () {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIndexedAttestationStub.returns(false);
    await regularSync.receiveCommitteeAttestation({attestation, subnet: 0});
    expect(chainStub.receiveAttestation.calledOnce).to.be.false;
  });

  it('should receive committee attestation', async function () {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIndexedAttestationStub.returns(true);
    opPoolStub.attestations = new AttestationOperations(dbStub.attestation, {config});
    await regularSync.receiveCommitteeAttestation({attestation, subnet: 0});
    expect(chainStub.receiveAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it('should skip Voluntary Exit - already exists', async function() {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(true);
    await regularSync.receiveVoluntaryExit(voluntaryExit);
    expect(opPoolStub.voluntaryExits.receive.calledOnce).to.be.equal(false);
  });

  it('should skip Voluntary Exit - invalid', async function() {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    isValidVoluntaryExitStub.returns(false);
    await regularSync.receiveVoluntaryExit(voluntaryExit);
    expect(opPoolStub.voluntaryExits.receive.calledOnce).to.be.equal(false);
  });

  it('should receive Voluntary Exit', async function() {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    isValidVoluntaryExitStub.returns(true);
    await regularSync.receiveVoluntaryExit(voluntaryExit);
    expect(opPoolStub.voluntaryExits.receive.calledOnceWith(voluntaryExit)).to.be.equal(true);
  });

  it('should skip Proposer Slashing - already exists', async function() {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(true);
    await regularSync.receiveProposerSlashing(slashing);
    expect(opPoolStub.proposerSlashings.receive.calledOnce).to.be.equal(false);
  });

  it('should skip Proposer Slashing - invalid', async function() {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    isValidProposerSlashingStub.returns(false);
    await regularSync.receiveProposerSlashing(slashing);
    expect(opPoolStub.proposerSlashings.receive.calledOnce).to.be.equal(false);
  });

  it('should receive Proposer Slashing', async function() {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    isValidProposerSlashingStub.returns(true);
    await regularSync.receiveProposerSlashing(slashing);
    expect(opPoolStub.proposerSlashings.receive.calledOnceWith(slashing)).to.be.equal(true);
  });

  it('should skip Attester Slashing - already exists', async function() {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(true);
    await regularSync.receiveAttesterSlashing(slashing);
    expect(opPoolStub.attesterSlashings.receive.calledOnce).to.be.equal(false);
  });

  it('should skip Attester Slashing - invalid', async function() {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    isValidAttesterSlashingStub.returns(false);
    await regularSync.receiveAttesterSlashing(slashing);
    expect(opPoolStub.attesterSlashings.receive.calledOnce).to.be.equal(false);
  });

  it('should receive Attester Slashing', async function() {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    isValidAttesterSlashingStub.returns(true);
    await regularSync.receiveAttesterSlashing(slashing);
    expect(opPoolStub.attesterSlashings.receive.calledOnceWith(slashing)).to.be.equal(true);
  });
});
