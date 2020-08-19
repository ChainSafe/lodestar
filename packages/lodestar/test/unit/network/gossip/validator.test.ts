import sinon, {SinonStub} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import * as bls from "@chainsafe/bls";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateState} from "../../../utils/state";
import {
  generateEmptyAttestation,
  generateEmptySignedAggregateAndProof,
  generateEmptySignedVoluntaryExit,
} from "../../../utils/attestation";
import {
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing,
} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {generateValidators} from "../../../utils/validator";
import {BeaconChain, StatefulDagLMDGHOST} from "../../../../src/chain";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../../../src/db";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState, SignedAggregateAndProof, SignedVoluntaryExit, ProposerSlashing, AttesterSlashing} from "@chainsafe/lodestar-types";
import {ExtendedValidatorResult} from "../../../../src/network/gossip/constants";

describe.only("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let dbStub: StubbedBeaconDb,
    logger: any,
    isValidIndexedAttestationStub: any,
    isValidIncomingVoluntaryExitStub: any,
    isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any,
    chainStub: StubbedChain,
    isBlsVerifyStub: SinonStub,
    state: TreeBacked<BeaconState>,
    epochCtx: EpochContext;

  beforeEach(() => {
    isValidIndexedAttestationStub = sandbox.stub(attestationUtils, "isValidIndexedAttestation");
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    chainStub = (sandbox.createStubInstance(BeaconChain) as unknown) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(StatefulDagLMDGHOST);
    isBlsVerifyStub = sandbox.stub(bls, "verify");

    dbStub = new StubbedBeaconDb(sandbox);
    logger = new WinstonLogger();
    logger.silent = true;
    validator = new GossipMessageValidator({
      chain: chainStub,
      db: (dbStub as unknown) as IBeaconDb,
      config,
      logger,
    });

    state = generateState({
      genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
      }),
      balances: Array.from(
        {length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE
      ),
    });
    epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate signed aggregate and proof", () => {
    let aggregateProof: SignedAggregateAndProof;
    beforeEach(() => {
      aggregateProof = generateEmptySignedAggregateAndProof();
      chainStub.getHeadStateContext.resolves({
        state: state as TreeBacked<BeaconState>,
        epochCtx: epochCtx,
      });
    });

    it("should return invalid signed aggregation and proof - invalid slot", async () => {
      state.genesisTime = Math.floor(new Date("2000-01-01").getTime()) / 1000;
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.ignore
      );
    });

    it("should return invalid signed aggregation and proof - existed", async () => {
      dbStub.aggregateAndProof.hasAttestation.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.ignore
      );
      expect(dbStub.aggregateAndProof.hasAttestation.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - prevent DOS", async () => {
      dbStub.aggregateAndProof.hasAttestation.resolves(false);
      dbStub.aggregateAndProof.getByAggregatorAndEpoch.resolves([generateEmptyAttestation()]);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.ignore
      );
      expect(dbStub.aggregateAndProof.getByAggregatorAndEpoch.calledOnce).to.be.true;
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - incorrect number of participants", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => [];
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
    });

    it("should return invalid signed aggregation and proof - block not existed", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => [0, 1];
      chainStub.forkChoice.hasBlock.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(chainStub.forkChoice.hasBlock.calledOnce).to.be.true;
      expect(dbStub.badBlock.has.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid block", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      epochCtx.getAttestingIndices = () => [0, 1];
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(dbStub.badBlock.has.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - not aggregator", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      epochCtx.isAggregator = () => false;
      epochCtx.getAttestingIndices = () => [0, 1];
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
    });

    it("should return invalid signed aggregation and proof - not beacon committee", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      epochCtx.isAggregator = () => true;
      epochCtx.getBeaconCommittee = () => [1000];
      epochCtx.getAttestingIndices = () => [0, 1];
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(isBlsVerifyStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid selection proof", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      epochCtx.getBeaconCommittee = () => [0];
      epochCtx.getAttestingIndices = () => [0, 1];
      epochCtx.isAggregator = () => true;
      isBlsVerifyStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(isBlsVerifyStub.calledOnce).to.be.true;
    });

    it("should return invalid signed aggregation and proof - invalid signature", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      epochCtx.getBeaconCommittee = () => [0];
      epochCtx.getAttestingIndices = () => [0, 1];
      epochCtx.isAggregator = () => true;
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(isBlsVerifyStub.calledTwice).to.be.true;
      expect(isValidIndexedAttestationStub.calledOnce).to.be.false;
    });

    it("should return invalid signed aggregation and proof - invalid indexed attestation", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      epochCtx.getAttestingIndices = () => [0, 1];
      epochCtx.getBeaconCommittee = () => [0];
      epochCtx.isAggregator = () => true;
      isBlsVerifyStub.onFirstCall().returns(true);
      isBlsVerifyStub.onSecondCall().returns(true);
      isValidIndexedAttestationStub.returns(false);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.reject
      );
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });

    it("should return valid signed aggregation and proof", async () => {
      dbStub.aggregateAndProof.has.resolves(false);
      chainStub.forkChoice.hasBlock.returns(true);
      dbStub.badBlock.has.resolves(false);
      chainStub.forkChoice.headStateRoot.returns(Buffer.alloc(0));
      epochCtx.getBeaconCommittee = () => [0];
      epochCtx.getAttestingIndices = () => [0, 1];
      epochCtx.isAggregator = () => true;
      isBlsVerifyStub.returns(true);
      isValidIndexedAttestationStub.returns(true);
      expect(await validator.isValidIncomingAggregateAndProof(aggregateProof)).to.be.equal(
        ExtendedValidatorResult.accept
      );
      expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
    });
  });

  describe("validate voluntary exit", () => {
    let voluntaryExit: SignedVoluntaryExit;

    beforeEach(() => {
      voluntaryExit = generateEmptySignedVoluntaryExit();
    });

    it("should return invalid Voluntary Exit - existing", async () => {
      dbStub.voluntaryExit.has.resolves(true);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.ignore);
      expect(isValidIncomingVoluntaryExitStub.called).to.be.false;
    });

    it("should return invalid Voluntary Exit - invalid", async () => {
      dbStub.voluntaryExit.has.resolves(false);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      isValidIncomingVoluntaryExitStub.returns(false);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.reject);
      expect(isValidIncomingVoluntaryExitStub.called).to.be.true;
    });

    it("should return valid Voluntary Exit", async () => {
      dbStub.voluntaryExit.has.resolves(false);
      chainStub.getHeadStateContext.resolves({state, epochCtx});
      isValidIncomingVoluntaryExitStub.returns(true);
      expect(await validator.isValidIncomingVoluntaryExit(voluntaryExit)).to.be.equal(ExtendedValidatorResult.accept);
    });
  });

  describe("Attester and Proposer Slashing", () => {
    describe("validate proposer slashing", () => {
      let slashing: ProposerSlashing,
      state: TreeBacked<BeaconState>;
  
      beforeEach(() => {
        slashing = generateEmptyProposerSlashing();
        state = generateState();
      });
      
      it("should return invalid proposer slashing - existing", async () => {
        dbStub.proposerSlashing.has.resolves(true);
        expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.ignore);
        expect(isValidIncomingProposerSlashingStub.called).to.be.false;
      });
  
      it("should return invalid proposer slashing - invalid", async () => {
        dbStub.proposerSlashing.has.resolves(false);
        chainStub.getHeadState.resolves(state);
        isValidIncomingProposerSlashingStub.returns(false);
        expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.reject);
        expect(isValidIncomingProposerSlashingStub.called).to.be.true;
      });
  
      it("should return valid proposer slashing", async () => {
        dbStub.proposerSlashing.has.resolves(false);
        chainStub.getHeadState.resolves(state);
        isValidIncomingProposerSlashingStub.returns(true);
        expect(await validator.isValidIncomingProposerSlashing(slashing)).to.be.equal(ExtendedValidatorResult.accept);
      });
    });
  
    describe("validate attester slashing", () => {
      let slashing: AttesterSlashing;
  
      beforeEach(() => {
        slashing = generateEmptyAttesterSlashing();
      });
  
      it("should return invalid attester slashing - already exisits", async () => {
        dbStub.attesterSlashing.hasAll.resolves(true);
        expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.ignore);
        expect(isValidIncomingAttesterSlashingStub.called).to.be.false;
      });
  
      it("should return invalid attester slashing - invalid", async () => {
        dbStub.attesterSlashing.hasAll.resolves(false);
        chainStub.getHeadState.resolves(state);
        isValidIncomingAttesterSlashingStub.returns(false);
        expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.reject);
        expect(isValidIncomingAttesterSlashingStub.called).to.be.true;
      });
  
      it("should return valid attester slashing", async () => {
        dbStub.attesterSlashing.hasAll.resolves(false);
        chainStub.getHeadState.resolves(state);
        isValidIncomingAttesterSlashingStub.returns(true);
        expect(await validator.isValidIncomingAttesterSlashing(slashing)).to.be.equal(ExtendedValidatorResult.accept);
      });
    });
  })
});
