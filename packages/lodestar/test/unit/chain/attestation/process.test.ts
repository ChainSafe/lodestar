import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";

import {processAttestation} from "../../../../src/chain/attestation/process";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain";
import {StateRegenerator} from "../../../../src/chain/regen";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {generateAttestation} from "../../../utils/attestation";
import {generateState} from "../../../utils/state";

describe("processAttestation", function () {
  const emitter = new ChainEventEmitter();
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let regen: SinonStubbedInstance<StateRegenerator>;
  let isValidIndexedAttestationStub: SinonStub;

  beforeEach(function () {
    forkChoice = sinon.createStubInstance(ForkChoice);
    regen = sinon.createStubInstance(StateRegenerator);
    isValidIndexedAttestationStub = sinon.stub(attestationUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    sinon.restore();
  });

  it("should throw on missing target state", async function () {
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
      expect(e.type.code).to.equal(AttestationErrorCode.TARGET_STATE_MISSING);
    }
  });

  it("should throw on errored getIndexedAttestation", async function () {
    const attestation = generateAttestation();
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.getIndexedAttestation.throws();
    regen.getCheckpointState.resolves({state, epochCtx: (epochCtx as unknown) as EpochContext});
    try {
      await processAttestation({
        emitter,
        forkChoice,
        regen,
        job: {attestation, validSignature: false},
      });
      expect.fail("attestation should throw");
    } catch (e) {
      expect(e.type.code).to.equal(AttestationErrorCode.NO_COMMITTEE_FOR_SLOT_AND_INDEX);
    }
  });

  it("should throw on invalid indexed attestation", async function () {
    const attestation = generateAttestation();
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.getIndexedAttestation.returns({} as IndexedAttestation);
    regen.getCheckpointState.resolves({state, epochCtx: (epochCtx as unknown) as EpochContext});
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
      expect(e.type.code).to.equal(AttestationErrorCode.INVALID_SIGNATURE);
    }
  });

  it("should emit 'attestation' event on processed attestation", async function () {
    const attestation = generateAttestation();
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.getIndexedAttestation.returns({} as IndexedAttestation);
    regen.getCheckpointState.resolves({state, epochCtx: (epochCtx as unknown) as EpochContext});
    isValidIndexedAttestationStub.returns(true);
    forkChoice.onAttestation.returns();

    const eventPromise = new Promise((resolve, reject) => {
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
