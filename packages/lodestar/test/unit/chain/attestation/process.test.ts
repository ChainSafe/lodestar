import {expect} from "chai";
import sinon, {SinonStubbedInstance} from "sinon";

import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ISignatureSet, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/block/isValidIndexedAttestation";
import * as signatureSetUtils from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/signatureSets/indexedAttestation";

import {processAttestation} from "../../../../src/chain/attestation/process";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain";
import {StateRegenerator} from "../../../../src/chain/regen";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {generateAttestation} from "../../../utils/attestation";
import {generateCachedState} from "../../../utils/state";
import {SinonStubFn} from "../../../utils/types";
import {AttestationError} from "../../../../src/chain/errors";
import {BlsVerifier} from "../../../../src/chain/bls";
import {IAttestationJob} from "../../../../src/chain";
import {verifyAttestationSignatures} from "../../../../lib/chain/attestation/process";
import {List} from "@chainsafe/ssz";

describe("verifyAttestationSignatures", function () {
  const emitter = new ChainEventEmitter();
  let regen: SinonStubbedInstance<StateRegenerator>;
  let bls: SinonStubbedInstance<BlsVerifier>;
  let getIndexedAttestationSignatureSetStub: SinonStubFn<typeof signatureSetUtils["getIndexedAttestationSignatureSet"]>;

  beforeEach(function () {
    regen = sinon.createStubInstance(StateRegenerator);
    bls = sinon.createStubInstance(BlsVerifier);
    getIndexedAttestationSignatureSetStub = sinon.stub(signatureSetUtils, "getIndexedAttestationSignatureSet");
  });

  afterEach(function () {
    sinon.restore();
  });

  it("all good attestation jobs", async function () {
    const attestations = [generateAttestation(), generateAttestation()];
    const jobs: IAttestationJob[] = attestations.map((attestation) => ({attestation, validSignature: false}));
    const state = generateCachedState();
    const indexedAttestation = {attestingIndices: [0] as List<phase0.ValidatorIndex>} as phase0.IndexedAttestation;
    sinon.stub(state.epochCtx, "getIndexedAttestation").returns(indexedAttestation);
    regen.getCheckpointState.resolves(state);
    getIndexedAttestationSignatureSetStub.returns({} as ISignatureSet);
    bls.verifySignatureSets.resolves(true);
    const emitStub = sinon.stub(emitter, "emit");
    const validJobs = await verifyAttestationSignatures({bls, regen, jobs, emitter});
    expect(validJobs.length).to.be.equal(2, "should return 2 valid jobs");
    expect(emitStub.calledOnce, "all jobs are good, should not emit errorAttestation events").to.be.false;
    for (let i = 0; i < 2; i++) {
      expect(validJobs[i]).to.be.deep.equal({attestation: attestations[i], indexedAttestation, validSignature: true});
    }
  });

  it("one good attestation job and one unknown target root", async function () {
    const attestations = [generateAttestation(), generateAttestation()];
    const jobs: IAttestationJob[] = attestations.map((attestation) => ({attestation, validSignature: false}));
    const state = generateCachedState();
    const indexedAttestation = {attestingIndices: [0] as List<phase0.ValidatorIndex>} as phase0.IndexedAttestation;
    sinon.stub(state.epochCtx, "getIndexedAttestation").returns(indexedAttestation);
    regen.getCheckpointState.onFirstCall().resolves(state);
    regen.getCheckpointState.onSecondCall().throws();
    getIndexedAttestationSignatureSetStub.returns({} as ISignatureSet);
    bls.verifySignatureSets.resolves(true);
    const emitSpy = sinon.spy(emitter, "emit");
    const validJobs = await verifyAttestationSignatures({bls, regen, jobs, emitter});
    expect(emitSpy.args.length).to.be.equal(1, "should emit once");
    expect(emitSpy.args[0][0]).to.be.equal(ChainEvent.errorAttestation, "incorrect emit event");
    const attestationError = emitSpy.args[0][1] as AttestationError;
    expect(attestationError.job).to.be.deep.equal(jobs[1]);
    expect(attestationError.type.code).to.be.equal(AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE);
    expect(validJobs.length).to.be.equal(1, "should return 1 valid jobs");
    expect(validJobs[0]).to.be.deep.equal({attestation: attestations[0], indexedAttestation, validSignature: true});
  });

  it("one good attestation job and one invalid signature", async function () {
    const attestations = [generateAttestation(), generateAttestation()];
    const jobs: IAttestationJob[] = attestations.map((attestation) => ({attestation, validSignature: false}));
    const state = generateCachedState();
    const indexedAttestation = {attestingIndices: [0] as List<phase0.ValidatorIndex>} as phase0.IndexedAttestation;
    sinon.stub(state.epochCtx, "getIndexedAttestation").returns(indexedAttestation);
    regen.getCheckpointState.resolves(state);
    getIndexedAttestationSignatureSetStub.returns({} as ISignatureSet);
    // verify both
    bls.verifySignatureSets.onFirstCall().resolves(false);
    // fallback, verify first
    bls.verifySignatureSets.onSecondCall().resolves(true);
    // fallback, verify second
    bls.verifySignatureSets.onThirdCall().resolves(false);
    const emitSpy = sinon.spy(emitter, "emit");
    const validJobs = await verifyAttestationSignatures({bls, regen, jobs, emitter});
    expect(emitSpy.args.length).to.be.equal(1, "should emit once");
    expect(emitSpy.args[0][0]).to.be.equal(ChainEvent.errorAttestation, "incorrect emit event");
    const attestationError = emitSpy.args[0][1] as AttestationError;
    expect(attestationError.job).to.be.deep.equal(jobs[1]);
    expect(attestationError.type.code).to.be.equal(AttestationErrorCode.INVALID_SIGNATURE);
    expect(validJobs.length).to.be.equal(1, "should return 1 valid jobs");
    expect(validJobs[0]).to.be.deep.equal({attestation: attestations[0], indexedAttestation, validSignature: true});
  });

  it("one good attestation and one invalid slot/index", async function () {
    const attestations = [generateAttestation(), generateAttestation()];
    const jobs: IAttestationJob[] = attestations.map((attestation) => ({attestation, validSignature: false}));
    const state = generateCachedState();
    const indexedAttestation = {attestingIndices: [0] as List<phase0.ValidatorIndex>} as phase0.IndexedAttestation;
    const getIndexedAttestationStub = sinon.stub(state.epochCtx, "getIndexedAttestation");
    getIndexedAttestationStub.onFirstCall().returns(indexedAttestation);
    getIndexedAttestationStub.onSecondCall().throws();
    regen.getCheckpointState.resolves(state);
    getIndexedAttestationSignatureSetStub.returns({} as ISignatureSet);
    bls.verifySignatureSets.resolves(true);
    const emitSpy = sinon.spy(emitter, "emit");
    const validJobs = await verifyAttestationSignatures({bls, regen, jobs, emitter});
    expect(emitSpy.args[0][0]).to.be.equal(ChainEvent.errorAttestation, "incorrect emit event");
    const attestationError = emitSpy.args[0][1] as AttestationError;
    expect(attestationError.job).to.be.deep.equal(jobs[1]);
    expect(attestationError.type.code).to.be.equal(AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX);
    expect(validJobs.length).to.be.equal(1, "should return 1 valid jobs");
    expect(validJobs[0]).to.be.deep.equal({attestation: attestations[0], indexedAttestation, validSignature: true});
  });
});

describe("processAttestation", function () {
  const emitter = new ChainEventEmitter();
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let regen: SinonStubbedInstance<StateRegenerator>;
  let isValidIndexedAttestationStub: SinonStubFn<typeof attestationUtils["isValidIndexedAttestation"]>;

  beforeEach(function () {
    forkChoice = sinon.createStubInstance(ForkChoice);
    regen = sinon.createStubInstance(StateRegenerator);
    isValidIndexedAttestationStub = sinon.stub(attestationUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    sinon.restore();
  });

  it("should throw on unknown target root", async function () {
    const attestation = generateAttestation();
    regen.getCheckpointState.throws();
    try {
      await processAttestation({
        emitter,
        forkChoice,
        regen,
        job: {attestation, validSignature: false},
      });
      expect.fail("attestation should throw");
    } catch (e) {
      expect((e as AttestationError).type.code).to.equal(AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE);
    }
  });

  it("should throw on errored getIndexedAttestation", async function () {
    const attestation = generateAttestation();
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getIndexedAttestation").throws();
    regen.getCheckpointState.resolves(state);
    try {
      await processAttestation({
        emitter,
        forkChoice,
        regen,
        job: {attestation, validSignature: false},
      });
      expect.fail("attestation should throw");
    } catch (e) {
      expect((e as AttestationError).type.code).to.equal(AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX);
    }
  });

  it("should throw on invalid indexed attestation", async function () {
    const attestation = generateAttestation();
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getIndexedAttestation").returns({} as phase0.IndexedAttestation);
    regen.getCheckpointState.resolves(state);
    isValidIndexedAttestationStub.returns(false);
    try {
      await processAttestation({
        emitter,
        forkChoice,
        regen,
        job: {attestation, validSignature: false},
      });
      expect.fail("attestation should throw");
    } catch (e) {
      expect((e as AttestationError).type.code).to.equal(AttestationErrorCode.INVALID_SIGNATURE);
    }
  });

  it("should emit 'attestation' event on processed attestation", async function () {
    const attestation = generateAttestation();
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getIndexedAttestation").returns({} as phase0.IndexedAttestation);
    regen.getCheckpointState.resolves(state);
    isValidIndexedAttestationStub.returns(true);
    forkChoice.onAttestation.returns();

    const eventPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(reject, 1000);
      emitter.once(ChainEvent.attestation, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await processAttestation({
      emitter,
      forkChoice,
      regen,
      job: {attestation, validSignature: false},
    });
    await eventPromise;
  });
});
