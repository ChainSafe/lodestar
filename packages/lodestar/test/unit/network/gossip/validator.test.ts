import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import {getAttestingIndicesFromCommittee} from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import * as bls from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateState} from "../../../utils/state";
import {
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof,
  generateEmptySignedVoluntaryExit
} from "../../../utils/attestation";
import {
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing
} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {generateValidators} from "../../../utils/validator";
import {BeaconChain, StatefulDagLMDGHOST} from "../../../../src/chain";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../../../src/db";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";
import {ExtendedValidatorResult} from "../../../../src/network/gossip/constants";

// TODO: fix this
describe.skip("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let dbStub: StubbedBeaconDb, logger: any, isValidIndexedAttestationStub: any,
    isValidIncomingVoluntaryExitStub: any, isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any, chainStub: StubbedChain,
    getAttestingIndicesStub: any,
    getAttestingIndicesFromCommitteeStub: SinonStub,
    isAggregatorStub: any, isBlsVerifyStub: SinonStub,
    getIndexedAttestationStub: SinonStub, epochCtxStub: SinonStubbedInstance<EpochContext>;

  beforeEach(() => {
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    getAttestingIndicesStub = sandbox.stub(attestationUtils, "getAttestingIndices");
    getAttestingIndicesFromCommitteeStub = sandbox.stub(attestationUtils, "getAttestingIndicesFromCommittee");
    isAggregatorStub = sandbox.stub(validatorUtils, "isAggregator");
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    getIndexedAttestationStub = sandbox.stub(attestationUtils, "getIndexedAttestation");
    chainStub = sandbox.createStubInstance(BeaconChain) as unknown as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
    epochCtxStub = sinon.createStubInstance(EpochContext);
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

  describe("validate committee attestation", () => {
    it("should return invalid committee attestation - invalid subnet", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      const attestation = generateEmptyAttestation();
      const invalidSubnet = 2000;
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, invalidSubnet)).to.be.equal(ExtendedValidatorResult.reject);
    });

    it("should return invalid committee attestation - invalid slot", async () => {
      const attestation = generateEmptyAttestation();
      const state = generateState({
        genesisTime: Math.floor(new Date("2000-01-01").getTime()) / 1000,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(chainStub.getHeadStateContext.calledOnce).to.be.true;
    });

    it("should return invalid committee attestation - invalid unaggregated attestation", async () => {
      const attestation = generateEmptyAttestation();
      // aggregationBits are all false
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      getAttestingIndicesFromCommitteeStub.returns([]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.reject);
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - prevent DOS", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([attestation]);
      getAttestingIndicesFromCommitteeStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.false;
      expect(getAttestingIndicesFromCommitteeStub.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - block not exist", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesFromCommitteeStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.reject);
      expect(dbStub.attestation.geAttestationsByTargetEpoch.calledOnce).to.be.true;
      expect(dbStub.block.has.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - bad block", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.badBlock.has.resolves(true);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesFromCommitteeStub.returns([0]);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.reject);
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.false;
    });

    it("should return invalid committee attestation - invalid attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesFromCommitteeStub.returns([0]);
      getIndexedAttestationStub.returns({attestingIndices: [], data: attestation.data, signature: Buffer.alloc(0)});
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });

    it("should return valid committee attestation", async () => {
      const attestation = generateEmptyAttestation();
      attestation.aggregationBits[0] = true;
      dbStub.block.has.resolves(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      dbStub.attestation.geAttestationsByTargetEpoch.resolves([]);
      getAttestingIndicesFromCommitteeStub.returns([0]);
      getIndexedAttestationStub.returns({attestingIndices: [], data: attestation.data, signature: Buffer.alloc(0)});
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingCommitteeAttestation(attestation, 0)).to.be.equal(ExtendedValidatorResult.accept);
    });
  });

  describe("validate signed aggregate and proof", () => {

    it("should return invalid signed aggregation and proof - invalid slot", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.ignore);
    });

    it("should return invalid signed aggregation and proof - existed", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.hasAttestation.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(dbStub.aggregateAndProof.hasAttestation.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - prevent DOS", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.hasAttestation.resolves(false);
      dbStub.aggregateAndProof.getByAggregatorAndEpoch.resolves([generateEmptyAttestation()]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(dbStub.aggregateAndProof.getByAggregatorAndEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - incorrect number of participants", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => ([]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
    });

    it("should return invalid signed aggregation and proof - block not existed", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => ([0,1]);
      chainStub.forkChoice.hasBlock.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid block", async () => {
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => ([0,1]);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - not aggregator", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.isAggregator = () => false;
      epochCtx.getAttestingIndices = () => ([0,1]);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
    });

    it("should return invalid signed aggregation and proof - not beacon committee", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.isAggregator = () => (true);
      epochCtx.getBeaconCommittee = () => ([1000]);
      epochCtx.getAttestingIndices = () => ([0,1]);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isBlsVerifyStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid selection proof", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.getBeaconCommittee = () => ([0]);
      epochCtx.getAttestingIndices = () => ([0,1]);
      epochCtx.isAggregator = () => (true);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      isBlsVerifyStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isBlsVerifyStub.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - invalid signature", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.getBeaconCommittee = () => ([0]);
      epochCtx.getAttestingIndices = () => ([0,1]);
      epochCtx.isAggregator = () => (true);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isBlsVerifyStub.calledTwice).to.be.true;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid indexed attestation", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.getAttestingIndices = () => ([0,1]);
      epochCtx.getBeaconCommittee = () => ([0]);
      epochCtx.isAggregator = () => (true);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(true);
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });

    it("should return valid signed aggregation and proof", async () => {
      const aggregateProof = generateEmptySignedAggregateAndProof();
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      epochCtx.getBeaconCommittee = () => ([0]);
      epochCtx.getAttestingIndices = () => ([0,1]);
      epochCtx.isAggregator = () => (true);
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
      isBlsVerifyStub.returns(true);
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(ExtendedValidatorResult.accept);
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  });


  describe("validate voluntary exit", () => {
    it("should return invalid Voluntary Exit - existing", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(true);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(isValidIncomingVoluntaryExitStub.called).to.be.false;
    });

    it("should return invalid Voluntary Exit - invalid", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      isValidIncomingVoluntaryExitStub.returns(false);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIncomingVoluntaryExitStub.called).to.be.true;
    });

    it("should return valid Voluntary Exit", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(false);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      isValidIncomingVoluntaryExitStub.returns(true);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.accept);
    });
  });

  describe("validate proposer slashing", () => {
    it("should return invalid proposer slashing - existing", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(true);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(isValidIncomingProposerSlashingStub.called).to.be.false;
    });

    it("should return invalid proposer slashing - invalid", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingProposerSlashingStub.returns(false);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIncomingProposerSlashingStub.called).to.be.true;
    });

    it("should return valid proposer slashing", async () => {
      const slashing = generateEmptyProposerSlashing();
      dbStub.proposerSlashing.has.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingProposerSlashingStub.returns(true);
      expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.accept);
    });
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(true);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(isValidIncomingAttesterSlashingStub.called).to.be.false;
    });

    it("should return invalid attester slashing - invalid", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingAttesterSlashingStub.returns(false);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIncomingAttesterSlashingStub.called).to.be.true;
    });

    it("should return valid attester slashing", async () => {
      const slashing = generateEmptyAttesterSlashing();
      dbStub.attesterSlashing.hasAll.resolves(false);
      const state = generateState();
      chainStub.getHeadState.resolves(state);
      isValidIncomingAttesterSlashingStub.returns(true);
      expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.accept);
    });
  });

});
