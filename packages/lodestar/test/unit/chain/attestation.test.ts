import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {AttestationProcessor} from "../../../src/chain/attestation";
import {BeaconChain, ILMDGHOST, StatefulDagLMDGHOST} from "../../../src/chain";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as utils from "@chainsafe/lodestar-beacon-state-transition/lib/util/attestation";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {generateEmptyBlockSummary} from "../../utils/block";
import {generateEmptyAttestation} from "../../utils/attestation";
import {generateState} from "../../utils/state";
import {generateValidators} from "../../utils/validator";
import {fail} from "assert";
import {StubbedBeaconDb} from "../../utils/stub";
import {Checkpoint, BeaconState} from "@chainsafe/lodestar-types";
import { EpochContext } from "@chainsafe/lodestar-beacon-state-transition";

describe("AttestationProcessor", function () {
  const sandbox = sinon.createSandbox();
  let attestationProcessor: AttestationProcessor;
  let chainStub: any, forkChoiceStub: SinonStubbedInstance<ILMDGHOST>, dbStub: any, logger: any,
    processAttestationStub: any, getAttestingIndicesStub: any;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain);
    forkChoiceStub = sandbox.createStubInstance(StatefulDagLMDGHOST);
    dbStub = new StubbedBeaconDb(sandbox, config);
    logger = new WinstonLogger();
    logger.silent = true;
    attestationProcessor = new AttestationProcessor(chainStub, forkChoiceStub, {config, db: dbStub, logger});
    getAttestingIndicesStub = sandbox.stub(utils, "getAttestingIndicesFromCommittee");
  });

  afterEach(() => {
    sandbox.restore();
    logger.silent = false;
  });

  it("receiveAttestation - should process attestation after receiveAttestation", async () => {
    processAttestationStub = sandbox.stub(attestationProcessor, "processAttestation");
    const attestation = generateEmptyAttestation();
    const block = generateEmptyBlockSummary();
    const state: BeaconState = generateState({
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
      }),
      balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    forkChoiceStub.getBlockSummaryByBlockRoot.returns(block);
    dbStub.stateCache.get.resolves(state);
    forkChoiceStub.hasBlock.returns(true);
    await attestationProcessor.receiveAttestation(attestation);
    expect(processAttestationStub.calledOnce).to.be.true;
  });

  it("receiveAttestation - should not process attestation after receiveAttestation - block not exist", async () => {
    processAttestationStub = sandbox.stub(attestationProcessor, "processAttestation");
    const attestation = generateEmptyAttestation();
    const block = generateEmptyBlockSummary();
    const state: BeaconState = generateState({
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
      }),
      balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    forkChoiceStub.getBlockSummaryByBlockRoot.returns(block);
    dbStub.stateCache.get.resolves(state);
    forkChoiceStub.hasBlock.returns(false);
    await attestationProcessor.receiveAttestation(attestation);
    expect(processAttestationStub.calledOnce).to.be.false;
  });

  it("processAttestation - should not call forkChoice - invalid target epoch", async () => {
    try {
      const attestation = generateEmptyAttestation();
      attestation.data.target.epoch = 2019;
      const attestationHash = config.types.Attestation.hashTreeRoot(attestation);
      const block = generateEmptyBlockSummary();
      forkChoiceStub.getBlockSummaryByBlockRoot.returns(block);
      const state: BeaconState = generateState({
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      dbStub.stateCache.get.resolves({state, epochCtx});
      forkChoiceStub.getJustified.returns({} as Checkpoint);

      await attestationProcessor.processAttestation(attestation, attestationHash);
      fail("expect an AssertionError");
    } catch (err) {
      expect(getAttestingIndicesStub.called).to.be.false;
      expect(forkChoiceStub.addAttestation.called).to.be.false;
    }
  });

  it("processAttestation - should not call forkChoice - invalid target root", async () => {
    try {
      const attestation = generateEmptyAttestation();
      const attestationHash = config.types.Attestation.hashTreeRoot(attestation);
      const block = generateEmptyBlockSummary();
      forkChoiceStub.getBlockSummaryByBlockRoot.returns(block);
      const state: BeaconState = generateState({
        validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
          activationEpoch: 0,
          effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
        }),
        balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
          () => config.params.MAX_EFFECTIVE_BALANCE),
      });
      state.genesisTime = state.genesisTime - config.params.SECONDS_PER_SLOT;
      const epochCtx = new EpochContext(config);
      epochCtx.loadState(state);
      dbStub.stateCache.get.resolves({state, epochCtx});
      forkChoiceStub.getJustified.returns(config.types.Checkpoint.defaultValue());
      forkChoiceStub.headBlockSlot.returns(0);
      getAttestingIndicesStub.returns([0]);
      state.balances = [];
      state.validators = generateValidators(3, {});

      await attestationProcessor.processAttestation(attestation, attestationHash);
      fail("expect an AssertionError");
    } catch (e) {
      expect(e.message).to.be.equal("FFG and LMD vote must be consistent with each other");
      expect(forkChoiceStub.getAncestor.called).to.be.true;
      expect(getAttestingIndicesStub.called).to.be.false;
      expect(forkChoiceStub.addAttestation.called).to.be.false;
    }
  });

  it("processAttestation - should call forkChoice", async () => {
    const attestation = generateEmptyAttestation();
    const attestationHash = config.types.Attestation.hashTreeRoot(attestation);
    const block = generateEmptyBlockSummary();
    forkChoiceStub.getBlockSummaryByBlockRoot.returns(block);
    const state: BeaconState = generateState({
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
      }),
      balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    state.genesisTime = state.genesisTime - config.params.SECONDS_PER_SLOT;
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    dbStub.stateCache.get.resolves({state, epochCtx});
    forkChoiceStub.getJustified.returns(config.types.Checkpoint.defaultValue());
    forkChoiceStub.headBlockSlot.returns(0);
    getAttestingIndicesStub.returns([0]);
    state.balances = [];
    state.validators = generateValidators(3, {});
    forkChoiceStub.getAncestor.returns(attestation.data.target.root as Uint8Array);

    await attestationProcessor.processAttestation(attestation, attestationHash);
    expect(getAttestingIndicesStub.called).to.be.true;
    expect(forkChoiceStub.addAttestation.called).to.be.true;
  });
});
