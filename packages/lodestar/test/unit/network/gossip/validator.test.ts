import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/block";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import * as bls from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateState} from "../../../utils/state";
import {generateEmptySignedBlock} from "../../../utils/block";
import {
  generateEmptyAggregateAndProof,
  generateEmptyAttestation,
  generateEmptySignedVoluntaryExit
} from "../../../utils/attestation";
import {
  AggregateAndProofRepository,
  AttestationRepository,
  AttesterSlashingRepository,
  BlockRepository,
  ProposerSlashingRepository,
  StateRepository,
  VoluntaryExitRepository
} from "../../../../src/db/api/beacon/repositories";
import {
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing
} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {generateValidators} from "../../../utils/validator";
import {BeaconChain, StatefulDagLMDGHOST} from "../../../../src/chain";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let verifyBlockSignatureStub: any, dbStub: any, logger: any, isValidIndexedAttestationStub: any,
    isValidIncomingVoluntaryExitStub: any, isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any, chainStub: any,
    getAttestingIndicesStub: any, isAggregatorStub: any, isBlsVerifyStub: any;

  beforeEach(() => {
    verifyBlockSignatureStub = sandbox.stub(blockUtils, "verifyBlockSignature");
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    getAttestingIndicesStub = sandbox.stub(attestationUtils, "getAttestingIndices");
    isAggregatorStub = sandbox.stub(validatorUtils, "isAggregator");
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    chainStub = sandbox.createStubInstance(BeaconChain);
    chainStub.forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
    isBlsVerifyStub = sandbox.stub(bls, "verify");

    dbStub = {
      block: sandbox.createStubInstance(BlockRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      voluntaryExit: sandbox.createStubInstance(VoluntaryExitRepository),
      proposerSlashing: sandbox.createStubInstance(ProposerSlashingRepository),
      attesterSlashing: sandbox.createStubInstance(AttesterSlashingRepository),
      state: sandbox.createStubInstance(StateRepository),
      aggregateAndProof: sandbox.createStubInstance(AggregateAndProofRepository),
      getStateForSlot: sandbox.stub(),
    };
    logger = new WinstonLogger();
    logger.silent = true;
    validator = new GossipMessageValidator({chain: chainStub, db: dbStub, config, logger});
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid incoming block - bad block", async () => {
    const block = generateEmptySignedBlock();
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return invalid incoming block - existing block", async () => {
    const block = generateEmptySignedBlock();
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return invalid incoming block - block is too old", async () => {
    const block = generateEmptySignedBlock();
    block.message.slot = 3;
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.finalizedCheckpoint.epoch = 1000;
    dbStub.state.get.resolves(state);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return invalid incoming block - invalid signature", async () => {
    const block = generateEmptySignedBlock();
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    verifyBlockSignatureStub.returns(false);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return valid incoming block", async () => {
    const block = generateEmptySignedBlock();
    block.message.slot = 3;
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    verifyBlockSignatureStub.returns(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
  });

  it("should return valid incoming block - block in previous epoch", async () => {
    const block = generateEmptySignedBlock();
    const epoch = 10;
    block.message.slot = (epoch - 1) * config.params.SLOTS_PER_EPOCH + 1;
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.slot = epoch * config.params.SLOTS_PER_EPOCH + 1;
    dbStub.state.get.resolves(state);
    verifyBlockSignatureStub.returns(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
  });

  it("should return invalid unaggregated attestation", () => {
    expect(validator.isUnaggregatedAttestation(generateEmptyAttestation())).to.be.equal(false);
  });

  it("should return valid unaggregated attestation", () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    expect(validator.isUnaggregatedAttestation(attestation)).to.be.equal(true);
  });

  it("should return invalid committee attestation - invalid subnet", async () => {
    const attestation = generateEmptyAttestation();
    const invalidSubnet = 2000;
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, invalidSubnet)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid unaggregated attestation", async () => {
    const attestation = generateEmptyAttestation();
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - block not exist", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.block.has.resolves(false);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - bad block", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid slot", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
    dbStub.state.get.resolves(state);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid attestation", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIndexedAttestationStub.returns(false);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return valid committee attestation", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIndexedAttestationStub.returns(true);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(true);
  });

  it.skip("should return invalid aggregation and proof - existed", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(true);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - block not existed", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - invalid block", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - invalid slot", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
    dbStub.state.get.resolves(state);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - invalid attestor index", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    getAttestingIndicesStub.returns([]);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - not aggregator", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - invalid selection proof", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.get.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
    expect(isValidIndexedAttestationStub.calledOnce).to.be.equal(false);
  });

  it.skip("should return invalid aggregation and proof - invalid indexed attestation", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.get.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(true);
    isValidIndexedAttestationStub.returns(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it.skip("should return valid aggregation and proof", async () => {
    const aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.get.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(true);
    isValidIndexedAttestationStub.returns(true);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(true);
  });
  
  it("should return invalid unaggregated attestation - attestation is not unaggregated", async () => {
    const attestation = generateEmptyAttestation();
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return invalid unaggregated attestation - attestation existed", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.attestation.has.resolves(true);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return invalid unaggregated attestation - attestation is too old", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.attestation.has.resolves(false);
    const state = generateState();
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 1;
    dbStub.state.get.resolves(state);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return valid unaggregated attestation", async () => {
    const attestation = generateEmptyAttestation();
    attestation.aggregationBits[0] = true;
    dbStub.attestation.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 2;
    dbStub.state.get.resolves(state);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(true);
  });

  it("should return invalid Voluntary Exit - existing", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(true);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(false);
  });

  it("should return invalid Voluntary Exit - invalid", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingVoluntaryExitStub.returns(false);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(false);
  });

  it("should return valid Voluntary Exit", async () => {
    const voluntaryExit = generateEmptySignedVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingVoluntaryExitStub.returns(true);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(true);
  });

  it("should return invalid proposer slashing - exising", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(true);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(false);
  });

  it("should return invalid proposer slashing - invalid", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingProposerSlashingStub.returns(false);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(false);
  });

  it("should return valid proposer slashing", async () => {
    const slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingProposerSlashingStub.returns(true);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(true);
  });

  it("should return invalid attester slashing - already exisits", async () => {
    const slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(true);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(false);
  });

  it("should return invalid attester slashing - invalid", async () => {
    const slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingAttesterSlashingStub.returns(false);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(false);
  });

  it("should return valid attester slashing", async () => {
    const slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
    const state = generateState();
    dbStub.state.get.resolves(state);
    isValidIncomingAttesterSlashingStub.returns(true);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(true);
  });

});
