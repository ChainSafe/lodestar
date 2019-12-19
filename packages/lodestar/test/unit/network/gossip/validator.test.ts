import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";

import * as blockUtils from "@chainsafe/eth2.0-state-transition/lib/util/block";
import * as attestationUtils from "@chainsafe/eth2.0-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/eth2.0-state-transition/lib/util/validatorStatus";
import * as dutiesUtils from "@chainsafe/eth2.0-state-transition/lib/util/duties";
import * as bls from "@chainsafe/bls";

import {WinstonLogger} from "../../../../src/logger";
import {generateState} from "../../../utils/state";
import {generateEmptyBlock} from "../../../utils/block";
import {generateEmptyAttestation, generateEmptyVoluntaryExit, generateEmptyAggregateAndProof} from "../../../utils/attestation";
import {AttestationRepository, BlockRepository, StateRepository} from "../../../../src/db/api/beacon/repositories";
import {VoluntaryExitRepository, ProposerSlashingRepository, AttesterSlashingRepository, AggregateAndProofRepository} from "../../../../src/db/api/beacon/repositories";
import {generateEmptyProposerSlashing, generateEmptyAttesterSlashing} from "@chainsafe/eth2.0-state-transition/test/utils/slashings";
import { GossipMessageValidator } from "../../../../src/network/gossip/validator";
import { generateValidators } from "../../../utils/validator";

describe("GossipMessageValidator", () => {
  let sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let isValidBlockSignatureStub: any, dbStub: any, opPoolStub: any, logger: any, isValidIndexedAttestationStub: any,
  isValidIncomingVoluntaryExitStub: any, isValidIncomingProposerSlashingStub: any, isValidIncomingAttesterSlashingStub: any,
  getAttestingIndicesStub: any, isAggregatorStub: any, isBlsVerifyStub: any;

  beforeEach(() => {
    isValidBlockSignatureStub = sandbox.stub(blockUtils, "isValidBlockSignature");
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    getAttestingIndicesStub = sandbox.stub(attestationUtils, "getAttestingIndices");
    isAggregatorStub = sandbox.stub(dutiesUtils, "isAggregator");
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    isBlsVerifyStub = sandbox.stub(bls, "verify");

    dbStub = {
      block: sandbox.createStubInstance(BlockRepository),
      attestation: sandbox.createStubInstance(AttestationRepository),
      voluntaryExit: sandbox.createStubInstance(VoluntaryExitRepository),
      proposerSlashing: sandbox.createStubInstance(ProposerSlashingRepository),
      attesterSlashing: sandbox.createStubInstance(AttesterSlashingRepository),
      state: sandbox.createStubInstance(StateRepository),
      aggregateAndProof: sandbox.createStubInstance(AggregateAndProofRepository),
    };
    logger = new WinstonLogger();
    logger.silent = true;
    validator = new GossipMessageValidator(dbStub, config, logger);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return invalid incoming block - bad block", async () => {
    let block = generateEmptyBlock();
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return invalid incoming block - existing block", async () => {
    let block = generateEmptyBlock();
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return invalid incoming block - invalid signature", async () => {
    let block = generateEmptyBlock();
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidBlockSignatureStub.returns(false);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(false);
  });

  it("should return valid incoming block", async () => {
    let block = generateEmptyBlock();
    dbStub.block.isBadBlock.resolves(false);
    dbStub.block.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidBlockSignatureStub.returns(true);
    expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
  });

  it("should return invalid unaggregated attestation", () => {
    expect(validator.isUnaggregatedAttestation(generateEmptyAttestation())).to.be.equal(false);
  });

  it("should return valid unaggregated attestation", () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    expect(validator.isUnaggregatedAttestation(attestation)).to.be.equal(true);
  });

  it("should return invalid committee attestation - invalid subnet", async () => {
    let attestation = generateEmptyAttestation();
    const invalidSubnet = 2000;
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, invalidSubnet)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid unaggregated attestation", async () => {
    let attestation = generateEmptyAttestation();
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - block not exist", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.block.has.resolves(false);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - bad block", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid slot", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
    dbStub.state.getLatest.resolves(state);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return invalid committee attestation - invalid attestation", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIndexedAttestationStub.returns(false);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(false);
  });

  it("should return valid committee attestation", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIndexedAttestationStub.returns(true);
    expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(true);
  });

  it("should return invalid aggregation and proof - existed", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(true);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - block not existed", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - invalid block", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(true);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - invalid slot", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
    dbStub.state.getLatest.resolves(state);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - invalid attestor index", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    getAttestingIndicesStub.returns([]);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - not aggregator", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - invalid selection proof", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.getLatest.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(false);
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
    expect(isValidIndexedAttestationStub.calledOnce).to.be.equal(false);
  });

  it("should return invalid aggregation and proof - invalid indexed attestation", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.getLatest.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(true);
    isValidIndexedAttestationStub.returns(false)
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(false);
  });

  it("should return valid aggregation and proof", async () => {
    let aggregateProof = generateEmptyAggregateAndProof();
    dbStub.aggregateAndProof.has.resolves(false);
    dbStub.block.has.resolves(true);
    dbStub.block.isBadBlock.resolves(false);
    let state = generateState();
    state.validators = generateValidators(1);
    dbStub.state.getLatest.resolves(state);
    getAttestingIndicesStub.returns([0]);
    isAggregatorStub.returns(true);
    isBlsVerifyStub.returns(true);
    isValidIndexedAttestationStub.returns(true)
    expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(true);
  });
  
  it("should return invalid unaggregated attestation - attestation is not unaggregated", async () => {
    let attestation = generateEmptyAttestation();
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return invalid unaggregated attestation - attestation existed", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.attestation.has.resolves(true);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return invalid unaggregated attestation - attestation is too old", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.attestation.has.resolves(false);
    let state = generateState();
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 1;
    dbStub.state.getLatest.resolves(state);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(false);
  });

  it("should return valid unaggregated attestation", async () => {
    let attestation = generateEmptyAttestation();
    attestation.aggregationBits.setBit(0, true);
    dbStub.attestation.has.resolves(false);
    let state = generateState();
    state.finalizedCheckpoint.epoch = 2;
    attestation.data.target.epoch = 2;
    dbStub.state.getLatest.resolves(state);
    expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.equal(true);
  });

  it("should return invalid Voluntary Exit - existing", async () => {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(true);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(false);
  });

  it("should return invalid Voluntary Exit - invalid", async () => {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingVoluntaryExitStub.returns(false);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(false);
  });

  it("should return valid Voluntary Exit", async () => {
    let voluntaryExit = generateEmptyVoluntaryExit();
    dbStub.voluntaryExit.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingVoluntaryExitStub.returns(true);
    expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(true);
  });

  it("should return invalid proposer slashing - exising", async () => {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(true);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(false);
  });

  it("should return invalid proposer slashing - invalid", async () => {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingProposerSlashingStub.returns(false);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(false);
  });

  it("should return valid proposer slashing", async () => {
    let slashing = generateEmptyProposerSlashing();
    dbStub.proposerSlashing.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingProposerSlashingStub.returns(true);
    expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(true);
  });

  it("should return invalid attester slashing - already exisits", async () => {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(true);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(false);
  });

  it("should return invalid attester slashing - invalid", async () => {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingAttesterSlashingStub.returns(false);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(false);
  });

  it("should return valid attester slashing", async () => {
    let slashing = generateEmptyAttesterSlashing();
    dbStub.attesterSlashing.has.resolves(false);
    let state = generateState();
    dbStub.state.getLatest.resolves(state);
    isValidIncomingAttesterSlashingStub.returns(true);
    expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(true);
  });

});
