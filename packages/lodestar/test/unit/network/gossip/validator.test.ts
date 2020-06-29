import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import * as stateTransitionUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/committee";
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
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing
} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {generateValidators} from "../../../utils/validator";
import {BeaconChain, StatefulDagLMDGHOST} from "../../../../src/chain";
import {getCurrentSlot, EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../../../src/db";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let verifyBlockSignatureStub: any, dbStub: StubbedBeaconDb, logger: any, isValidIndexedAttestationStub: any,
    isValidIncomingVoluntaryExitStub: any, isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any, chainStub: StubbedChain,
    getAttestingIndicesStub: any, isAggregatorStub: any, isBlsVerifyStub: SinonStub,
    getIndexedAttestationStub: SinonStub, epochCtxStub: SinonStubbedInstance<EpochContext>;

  beforeEach(() => {
    verifyBlockSignatureStub = sandbox.stub(blockUtils, "verifyBlockSignature");
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    getAttestingIndicesStub = sandbox.stub(attestationUtils, "getAttestingIndices");
    isAggregatorStub = sandbox.stub(validatorUtils, "isAggregator");
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    getIndexedAttestationStub = sandbox.stub(attestationUtils, "getIndexedAttestation");
    chainStub = sandbox.createStubInstance(BeaconChain) as unknown as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
    epochCtxStub = sinon.createStubInstance(EpochContext);
    chainStub.getEpochContext.returns(epochCtxStub as unknown as EpochContext);
    isBlsVerifyStub = sandbox.stub(bls, "verify");

    dbStub = new StubbedBeaconDb(sandbox);
    logger = new WinstonLogger();
    logger.silent = true;
    validator = new GossipMessageValidator({
      chain: chainStub,
      db: dbStub as unknown as IBeaconDb,
      config, logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate incoming block", () => {
    it("should return invalid incoming block - block is in the future", async () => {
      const block = generateEmptySignedBlock();
      block.message.slot = 3;
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(chainStub.getBlockAtSlot.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - block is too old", async () => {
      const block = generateEmptySignedBlock();
      block.message.slot = 3;
      dbStub.badBlock.has.resolves(false);
      const state = generateState();
      state.finalizedCheckpoint.epoch = 1000;
      chainStub.getHeadState.resolves(state);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(chainStub.getBlockAtSlot.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - prevent DOS", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT});
      chainStub.getHeadState.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      chainStub.getBlockAtSlot.resolves(block);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(chainStub.getBlockAtSlot.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - bad block", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT});
      chainStub.getHeadState.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      chainStub.getBlockAtSlot.resolves(null);
      dbStub.badBlock.has.resolves(true);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
      expect(verifyBlockSignatureStub.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - invalid signature", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT});
      chainStub.getHeadState.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      chainStub.getBlockAtSlot.resolves(null);
      dbStub.badBlock.has.resolves(false);
      verifyBlockSignatureStub.returns(false);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(verifyBlockSignatureStub.calledOnce).to.be.true;
      expect(epochCtxStub.getBeaconProposer.calledOnce).to.be.false;
    });

    it("should return invalid incoming block - invalid proposer index", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT});
      chainStub.getHeadState.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      chainStub.getBlockAtSlot.resolves(null);
      dbStub.badBlock.has.resolves(false);
      verifyBlockSignatureStub.returns(true);
      epochCtxStub.getBeaconProposer.returns(1000);
      expect(await validator.isValidIncomingBlock(block)).to.be.false;
      expect(epochCtxStub.getBeaconProposer.calledOnce).to.be.true;
    });

    it("should return valid incoming block", async () => {
      const state = generateState({genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT});
      chainStub.getHeadState.resolves(state);
      const block = generateEmptySignedBlock();
      block.message.slot = getCurrentSlot(config, state.genesisTime);
      chainStub.getBlockAtSlot.resolves(null);
      dbStub.badBlock.has.resolves(false);
      verifyBlockSignatureStub.returns(true);
      epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex);
      expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
      expect(epochCtxStub.getBeaconProposer.calledOnce).to.be.true;
    });

    it("should return valid incoming block - block in previous epoch", async () => {
      const block = generateEmptySignedBlock();
      const epoch = 10;
      block.message.slot = (epoch - 1) * config.params.SLOTS_PER_EPOCH + 1;
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(false);
      const state = generateState();
      state.slot = epoch * config.params.SLOTS_PER_EPOCH + 1;
      state.genesisTime = (state.slot) * config.params.SECONDS_PER_SLOT;
      chainStub.getHeadState.resolves(state);
      verifyBlockSignatureStub.returns(true);
      epochCtxStub.getBeaconProposer.returns(block.message.proposerIndex);
      expect(await validator.isValidIncomingBlock(block)).to.be.equal(true);
    });
  });

  describe("validate committee attestation", () => {
    it("should return invalid committee attestation - invalid subnet", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const attestation = generateEmptyAttestation();
      const invalidSubnet = 2000;
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, invalidSubnet)).to.be.false;
    });

    it("should return invalid committee attestation - invalid slot", async () => {
      const attestation = generateEmptyAttestation();
      const state = generateState();
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      chainStub.getHeadState.resolves(state);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(chainStub.getHeadState.calledOnce).to.be.true;
    });

    it("should return invalid committee attestation - invalid unaggregated attestation", async () => {
      const attestation = generateEmptyAttestation();
      // aggregationBits are all false
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      getAttestingIndicesStub.returns([]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - prevent DOS", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([attestation]);
      getAttestingIndicesStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.false;
      expect(getAttestingIndicesStub.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - block not exist", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      chainStub.forkChoice.hasBlock.returns(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - bad block", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(true);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - invalid attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesStub.returns([0]);
      getIndexedAttestationStub.returns({attestingIndices: [], data: attestation.data, signature: Buffer.alloc(0)});
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.false;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });

    it("should return valid committee attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesStub.returns([0]);
      getIndexedAttestationStub.returns({attestingIndices: [], data: attestation.data, signature: Buffer.alloc(0)});
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(true);
    });
  });

  describe("validate signed aggregate and proof", () => {

    it("should return invalid signed aggregation and proof - invalid slot", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      const state = generateState();
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      chainStub.getHeadState.resolves(state);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
    });

    it("should return invalid signed aggregation and proof - existed", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.hasAttestation.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(dbStub.aggregateAndProof.hasAttestation.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - prevent DOS", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.hasAttestation.resolves(false);
      dbStub.aggregateAndProof.getByAggregatorAndEpoch.resolves([generateEmptyAttestation()]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(dbStub.aggregateAndProof.getByAggregatorAndEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - incorrect number of participants", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(getAttestingIndicesStub.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - block not existed", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid block", async () => {
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
      expect(isAggregatorStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - not aggregator", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isAggregatorStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isAggregatorStub.calledOnce).to.be.true;
      expect(epochCtxStub.getBeaconCommittee.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - not beacon committee", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isAggregatorStub.returns(true);
      epochCtxStub.getBeaconCommittee.returns([1000]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(epochCtxStub.getBeaconCommittee.called).to.be.true;
      expect(isBlsVerifyStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid selection proof", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      chainStub.getHeadState.resolves(state);
      epochCtxStub.getBeaconCommittee.returns([0]);
      isAggregatorStub.returns(true);
      isBlsVerifyStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.false;
      expect(isBlsVerifyStub.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - invalid signature", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      chainStub.getHeadState.resolves(state);
      epochCtxStub.getBeaconCommittee.returns([0]);
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
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      chainStub.getHeadState.resolves(state);
      epochCtxStub.getBeaconCommittee.returns([0]);
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
      getAttestingIndicesStub.returns([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState();
      state.validators = generateValidators(1);
      chainStub.getHeadState.resolves(state);
      epochCtxStub.getBeaconCommittee.returns([0]);
      isAggregatorStub.returns(true);
      isBlsVerifyStub.returns(true);
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(true);
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  });


  describe("validate voluntary exit", () => {
    it("should return invalid Voluntary Exit - existing", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(true);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.false;
      expect(isValidIncomingVoluntaryExitStub.called).to.be.false;
    });

    it("should return invalid Voluntary Exit - invalid", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingVoluntaryExitStub.returns(false);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.false;
      expect(isValidIncomingVoluntaryExitStub.called).to.be.true;
    });

    it("should return valid Voluntary Exit", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingVoluntaryExitStub.returns(true);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(true);
    });
  });

  describe("validate proposer slashing", () => {
    it("should return invalid proposer slashing - existing", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(true);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.false;
      expect(isValidIncomingProposerSlashingStub.called).to.be.false;
    });

    it("should return invalid proposer slashing - invalid", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingProposerSlashingStub.returns(false);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.false;
      expect(isValidIncomingProposerSlashingStub.called).to.be.true;
    });

    it("should return valid proposer slashing", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingProposerSlashingStub.returns(true);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(true);
    });
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(true);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.false;
      expect(isValidIncomingAttesterSlashingStub.called).to.be.false;
    });

    it("should return invalid attester slashing - invalid", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingAttesterSlashingStub.returns(false);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.false;
      expect(isValidIncomingAttesterSlashingStub.called).to.be.true;
    });

    it("should return valid attester slashing", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingAttesterSlashingStub.returns(true);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(true);
    });
  });

});
