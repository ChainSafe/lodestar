import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as validatorStatusUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validatorStatus";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateState} from "../../../utils/state";
import {generateEmptySignedVoluntaryExit} from "../../../utils/attestation";
import {
  generateEmptyAttesterSlashing,
  generateEmptyProposerSlashing,
} from "@chainsafe/lodestar-beacon-state-transition/test/utils/slashings";
import {GossipMessageValidator} from "../../../../src/network/gossip/validator";
import {generateValidators} from "../../../utils/validator";
import {generateInitialMaxBalances} from "../../../utils/balances";
import {BeaconChain, ArrayDagLMDGHOST} from "../../../../src/chain";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb} from "../../../../src/db";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {ExtendedValidatorResult} from "../../../../src/network/gossip/constants";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let validator: GossipMessageValidator;
  let dbStub: StubbedBeaconDb,
    logger: any,
    isValidIncomingVoluntaryExitStub: any,
    isValidIncomingProposerSlashingStub: any,
    isValidIncomingAttesterSlashingStub: any,
    chainStub: StubbedChain;

  beforeEach(() => {
    isValidIncomingVoluntaryExitStub = sandbox.stub(validatorStatusUtils, "isValidVoluntaryExit");
    isValidIncomingProposerSlashingStub = sandbox.stub(validatorStatusUtils, "isValidProposerSlashing");
    isValidIncomingAttesterSlashingStub = sandbox.stub(validatorStatusUtils, "isValidAttesterSlashing");
    chainStub = (sandbox.createStubInstance(BeaconChain) as unknown) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ArrayDagLMDGHOST);

    dbStub = new StubbedBeaconDb(sandbox);
    logger = new WinstonLogger();
    logger.silent = true;
    validator = new GossipMessageValidator({
      chain: chainStub,
      db: (dbStub as unknown) as IBeaconDb,
      config,
      logger,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("validate voluntary exit", () => {
    it("should return invalid Voluntary Exit - existing", async () => {
      const voluntaryExit = generateEmptySignedVoluntaryExit();
      dbStub.voluntaryExit.has.resolves(true);
      const state = generateState({
        genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
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
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
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
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
        }),
        balances: generateInitialMaxBalances(config),
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
