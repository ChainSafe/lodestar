/* eslint-disable @typescript-eslint/no-unused-vars */
import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import * as attestationUtils from "@chainsafe/eth2.0-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/eth2.0-state-transition/lib/util/validatorStatus";
import {BeaconChain} from "../../../src/chain";
import {Libp2pNetwork} from "../../../src/network";
import {
  AggregateAndProofOperations,
  AttestationOperations,
  AttesterSlashingOperations,
  OpPool,
  ProposerSlashingOperations,
  VoluntaryExitOperations
} from "../../../src/opPool";
import {WinstonLogger} from "@chainsafe/eth2.0-utils/lib/logger";
import {RegularSync} from "../../../src/sync/regular";
import {generateEmptySignedBlock} from "../../utils/block";
import {
  generateEmptyAggregateAndProof,
  generateEmptyAttestation,
  generateEmptySignedVoluntaryExit
} from "../../utils/attestation";
import {
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "../../../src/db/api/beacon/repositories";
import {
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing
} from "@chainsafe/eth2.0-state-transition/test/utils/slashings";
import {describe, it, beforeEach, afterEach} from "mocha";


describe("syncing", function () {
  const sandbox = sinon.createSandbox();
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
    opPoolStub.aggregateAndProofs = sandbox.createStubInstance(AggregateAndProofOperations);
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


  it("should able to receive block", async function () {
    const block = generateEmptySignedBlock();
    dbStub.block.has.resolves(false);
    chainStub.receiveBlock.resolves(0);
    try {
      await regularSync.receiveBlock(block);
      expect(chainStub.receiveBlock.calledOnceWith(block)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }

  });

  it("should receive attestation", async function () {
    const attestation = generateEmptyAttestation();
    opPoolStub.attestations = new AttestationOperations(dbStub.attestation, {config});
    try {
      await regularSync.receiveAttestation(attestation);
      expect(chainStub.receiveAttestation.calledOnceWith(attestation)).to.be.true;
    }catch (e) {
      expect.fail(e.stack);
    }
  });

  it("should receive aggregate and proof", async function() {
    const aggregateProof = generateEmptyAggregateAndProof();
    await regularSync.receiveAggregateAndProof(aggregateProof);
    expect(opPoolStub.aggregateAndProofs.receive.calledOnceWith(aggregateProof)).to.be.equal(true);
  });

  it("should receive Voluntary Exit", async function() {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    await regularSync.receiveVoluntaryExit(voluntaryExit);
    expect(opPoolStub.voluntaryExits.receive.calledOnceWith(voluntaryExit)).to.be.equal(true);
  });

  it("should receive Proposer Slashing", async function() {
    const slashing = generateEmptyProposerSlashing();
    await regularSync.receiveProposerSlashing(slashing);
    expect(opPoolStub.proposerSlashings.receive.calledOnceWith(slashing)).to.be.equal(true);
  });

  it("should receive Attester Slashing", async function() {
    const slashing = generateEmptyAttesterSlashing();
    await regularSync.receiveAttesterSlashing(slashing);
    expect(opPoolStub.attesterSlashings.receive.calledOnceWith(slashing)).to.be.equal(true);
  });
});
