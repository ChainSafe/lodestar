import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";

import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/block";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import * as bls from "@chainsafe/bls";
import * as proposerUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/proposer";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateState} from "../../../utils/state";
import {generateEmptySignedBlock} from "../../../utils/block";
import {
  generateEmptyAttestation,
  generateEmptySignedVoluntaryExit,
  generateEmptySignedAggregateAndProof
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
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {OpPool, AggregateAndProofOperations, AttestationOperations} from "../../../../src/opPool";
import Sinon from "sinon";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let verifyBlockSignatureStub: any, dbStub: any, logger: any, isValidIndexedAttestationStub: any,
    isValidIncomingVoluntaryExitStub: any, isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any, chainStub: any,
    getAttestingIndicesStub: any, isAggregatorStub: any, isBlsVerifyStub: Sinon.SinonStub,
    opPoolStub: any, getBeaconProposerIndexStub: Sinon.SinonStub;

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
    opPoolStub = {
      attestations: sandbox.createStubInstance(AttestationOperations),
      aggregateAndProofs: sandbox.createStubInstance(AggregateAndProofOperations)
    } as unknown as OpPool;
    getBeaconProposerIndexStub = sandbox.stub(proposerUtils, "getBeaconProposerIndex");

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
    validator = new GossipMessageValidator({chain: chainStub, db: dbStub, opPool: opPoolStub, config, logger});
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate incoming block", () => {
    it("should return invalid incoming block - block is in the future", async () => {
      const block = generateEmptySignedBlock();
      block.message.slot = 3;
      const state = generateState();
      dbStub.state.get.resolves(state);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(dbStub.block.getBlockBySlot.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - block is too old", async () => {
      const block = generateEmptySignedBlock();
      block.message.slot = 3;
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      state.finalizedCheckpoint.epoch = 1000;
      dbStub.state.get.resolves(state);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(dbStub.block.getBlockBySlot.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - prevent DOS", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT });
      dbStub.state.get.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      dbStub.block.getBlockBySlot.resolves(block);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(dbStub.block.getBlockBySlot.calledOnce).to.be.true;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - bad block", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT });
      dbStub.state.get.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      dbStub.block.getBlockBySlot.resolves(null);
      dbStub.block.isBadBlock.resolves(true);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.true;
      expect(verifyBlockSignatureStub.calledOnce).to.be.false;
    });
  
    it("should return invalid incoming block - invalid signature", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT });
      dbStub.state.get.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      dbStub.block.getBlockBySlot.resolves(null);
      dbStub.block.isBadBlock.resolves(false);
      verifyBlockSignatureStub.returns(false);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(verifyBlockSignatureStub.calledOnce).to.be.true;
      expect(getBeaconProposerIndexStub.calledOnce).to.be.false;
    });
  
    it("should return invalid incoming block - invalid proposer index", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT });
      dbStub.state.get.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      dbStub.block.getBlockBySlot.resolves(null);
      dbStub.block.isBadBlock.resolves(false);
      verifyBlockSignatureStub.returns(true);
      getBeaconProposerIndexStub.returns(1000);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
    });
  
    it("should return valid incoming block", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT });
      dbStub.state.get.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      dbStub.block.getBlockBySlot.resolves(null);
      dbStub.block.isBadBlock.resolves(false);
      verifyBlockSignatureStub.returns(true);
      getBeaconProposerIndexStub.returns(block.message.proposerIndex);
      expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
      expect(getBeaconProposerIndexStub.calledOnce).to.be.true;
    });
  
    it("should return valid incoming block - block in previous epoch", async () => {
      const block = generateEmptySignedBlock();
      const epoch = 10;
      block.message.slot = (epoch - 1) * config.params.SLOTS_PER_EPOCH + 1;
      dbStub.block.isBadBlock.resolves(false);
      dbStub.block.has.resolves(false);
      const state = generateState();
      state.slot = epoch * config.params.SLOTS_PER_EPOCH + 1;
      state.genesisTime = (state.slot) * config.params.SECONDS_PER_SLOT;
      dbStub.state.get.resolves(state);
      verifyBlockSignatureStub.returns(true);
      getBeaconProposerIndexStub.returns(block.message.proposerIndex);
      expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
    });
  });

  describe("validate unaggregated attestation", () => {
    it("should return invalid unaggregated attestation", () => {
      expect(validator.isUnaggregatedAttestation(generateEmptyAttestation())).to.be.false;
    });
  
    it("should return valid unaggregated attestation", () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      expect(validator.isUnaggregatedAttestation(attestation)).to.be.equal(true);
    });
  });

  describe("validate committee attestation", () => {
    it("should return invalid committee attestation - invalid subnet", async () => {
      const attestation = generateEmptyAttestation();
      const invalidSubnet = 2000;
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, invalidSubnet)).to.be.false;
    });
  
    it("should return invalid committee attestation - invalid unaggregated attestation", async () => {
      const attestation = generateEmptyAttestation();
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.block.has.calledOnce).to.be.false;
    });
  
    it("should return invalid committee attestation - block not exist", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(false);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.block.has.calledOnce).to.be.true;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.false;
    });
  
    it("should return invalid committee attestation - bad block", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(true);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.true;
    });
  
    it("should return invalid committee attestation - invalid slot", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      dbStub.state.get.resolves(state);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.true;
    });
  
    it("should return invalid committee attestation - prevent DOS", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      dbStub.state.get.resolves(state);
      opPoolStub.attestations.geAttestationsBySlot.resolves([attestation]);
      getAttestingIndicesStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.true;
      expect(opPoolStub.attestations.geAttestationsBySlot.calledOnce).to.be.true;
    });
  
    it("should return invalid committee attestation - invalid attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      dbStub.state.get.resolves(state);
      opPoolStub.attestations.geAttestationsBySlot.resolves([]);
      getAttestingIndicesStub.returns([0]);
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  
    it("should return valid committee attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      dbStub.state.get.resolves(state);
      opPoolStub.attestations.geAttestationsBySlot.resolves([]);
      getAttestingIndicesStub.returns([0]);
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(true);
    });
  });

  describe("validate signed aggregate and proof", () => {

    it("should return invalid signed aggregation and proof - invalid slot", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      const state = generateState();
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      dbStub.state.get.resolves(state);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
    });

    it("should return invalid signed aggregation and proof - existed", async () => {
      const state = generateState();
      dbStub.state.get.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      opPoolStub.aggregateAndProofs.hasAttestation.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(opPoolStub.aggregateAndProofs.hasAttestation.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - prevent DOS", async () => {
      const state = generateState();
      dbStub.state.get.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      opPoolStub.aggregateAndProofs.hasAttestation.resolves(false);
      opPoolStub.aggregateAndProofs.getByAggregatorAndSlot.resolves([generateEmptyAttestation()]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(opPoolStub.aggregateAndProofs.getByAggregatorAndSlot.calledOnce).to.be.true;
      expect(dbStub.block.has.calledOnce).to.be.false;
    });
  
    it("should return invalid signed aggregation and proof - block not existed", async () => {
      const state = generateState();
      dbStub.state.get.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(dbStub.block.has.calledOnce).to.be.true;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.false;
    });
  
    it("should return invalid signed aggregation and proof - invalid block", async () => {
      const state = generateState();
      dbStub.state.get.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(dbStub.block.isBadBlock.calledOnce).to.be.true;
      expect(isAggregatorStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - not aggregator", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      dbStub.state.get.resolves(state);
      getAttestingIndicesStub.returns([0]);
      isAggregatorStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isAggregatorStub.calledOnce).to.be.true;
      expect(getAttestingIndicesStub.calledOnce).to.be.false;
    });
  
    it("should return invalid signed aggregation and proof - invalid attestor", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      const state = generateState();
      dbStub.state.get.resolves(state);
      isAggregatorStub.returns(true);
      getAttestingIndicesStub.returns([]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(getAttestingIndicesStub.calledOnce).to.be.true;
      expect(isBlsVerifyStub.calledOnce).to.be.false;
    });
  
    it("should return invalid signed aggregation and proof - invalid selection proof", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
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
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isBlsVerifyStub.calledOnce).to.be.true;
    });
  
    it("should return invalid signed aggregation and proof - invalid signature", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      dbStub.state.get.resolves(state);
      getAttestingIndicesStub.returns([0]);
      isAggregatorStub.returns(true);
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isBlsVerifyStub.calledTwice).to.be.true;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.false;
    });
  
    it("should return invalid signed aggregation and proof - invalid indexed attestation", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      dbStub.block.has.resolves(true);
      dbStub.block.isBadBlock.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      dbStub.state.get.resolves(state);
      getAttestingIndicesStub.returns([0]);
      isAggregatorStub.returns(true);
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(true);
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  
    it("should return valid signed aggregation and proof", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
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
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  });

  describe("validate unaggregated attestation", () => {
    it("should return invalid unaggregated attestation - attestation is not unaggregated", async () => {
      const attestation = generateEmptyAttestation();
      expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.false;
    });
  
    it("should return invalid unaggregated attestation - attestation existed", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.attestation.has.resolves(true);
      expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.false;
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
      expect(await validator.isValidIncomingUnaggregatedAttestation(attestation)).to.be.false;
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
  });

  describe("validate voluntary exit", () => {
    it("should return invalid Voluntary Exit - existing", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(true);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.false;
    });
  
    it("should return invalid Voluntary Exit - invalid", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      dbStub.state.get.resolves(state);
      isValidIncomingVoluntaryExitStub.returns(false);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.false;
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
  });

  describe("validate proposer slashing", () => {
    it("should return invalid proposer slashing - existing", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(true);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.false;
    });
  
    it("should return invalid proposer slashing - invalid", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      dbStub.state.get.resolves(state);
      isValidIncomingProposerSlashingStub.returns(false);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.false;
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
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.has.resolves(true);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.false;
    });
  
    it("should return invalid attester slashing - invalid", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      dbStub.state.get.resolves(state);
      isValidIncomingAttesterSlashingStub.returns(false);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.false;
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

});
