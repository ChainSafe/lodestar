import {expect} from "chai";
import sinon from "sinon";
import {List} from "@chainsafe/ssz";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/mainnet";
import * as processProposerSlashing from "../../../../../src/naive/phase0/block/operations/proposerSlashing";
import * as processAttesterSlashing from "../../../../../src/naive/phase0/block/operations/attesterSlashing";
import * as processAttestation from "../../../../../src/naive/phase0/block/operations/attestation";
import * as processDeposit from "../../../../../src/naive/phase0/block/operations/deposit";
import * as processVoluntaryExit from "../../../../../src/naive/phase0/block/operations/voluntaryExit";
import {processOperations} from "../../../../../src/naive/phase0/block/operations";

import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateDeposit} from "../../../../utils/deposit";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptySignedVoluntaryExit} from "../../../../utils/voluntaryExits";
import {SinonStubFn} from "../../../../utils/types";

/* eslint-disable no-empty */

describe("process block - process operations", function () {
  const sandbox = sinon.createSandbox();
  let state: phase0.BeaconState, body: phase0.BeaconBlockBody;

  let processProposerSlashingStub: SinonStubFn<typeof processProposerSlashing["processProposerSlashing"]>,
    processAttesterSlashingStub: SinonStubFn<typeof processAttesterSlashing["processAttesterSlashing"]>,
    processAttestationStub: SinonStubFn<typeof processAttestation["processAttestation"]>,
    processDepositStub: SinonStubFn<typeof processDeposit["processDeposit"]>,
    processVoluntaryExitStub: SinonStubFn<typeof processVoluntaryExit["processVoluntaryExit"]>;

  beforeEach(() => {
    processProposerSlashingStub = sandbox.stub(processProposerSlashing, "processProposerSlashing");
    processAttesterSlashingStub = sandbox.stub(processAttesterSlashing, "processAttesterSlashing");
    processAttestationStub = sandbox.stub(processAttestation, "processAttestation");
    processDepositStub = sandbox.stub(processDeposit, "processDeposit");
    processVoluntaryExitStub = sandbox.stub(processVoluntaryExit, "processVoluntaryExit");
    state = generateState();
    body = generateEmptyBlock().body;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should fail to process operations - outstanding deposits not processed up to the maximum", function () {
    body.deposits.push(generateDeposit());
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {}
  });

  it("should fail to process operations - duplicate transfers", function () {
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {}
  });

  it("should fail to process operations - proposerSlashings length  exceed maxProposerSlashings ", function () {
    body.proposerSlashings = Array.from({length: MAX_PROPOSER_SLASHINGS + 1}, () =>
      ssz.phase0.ProposerSlashing.defaultValue()
    ) as List<phase0.ProposerSlashing>;
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {}
  });

  it("should fail to process operations - attesterSlashings length  exceed maxAttesterSlashings", function () {
    processProposerSlashingStub.returns();
    body.attesterSlashings = Array.from({length: MAX_ATTESTER_SLASHINGS + 1}, () =>
      ssz.phase0.AttesterSlashing.defaultValue()
    ) as List<phase0.AttesterSlashing>;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
    }
  });

  it("should fail to process operations - attestation length  exceed maxAttestation", function () {
    processProposerSlashingStub.returns();
    processAttesterSlashingStub.returns();
    body.attestations = Array.from({length: MAX_ATTESTATIONS + 1}, () => ssz.phase0.Attestation.defaultValue()) as List<
      phase0.Attestation
    >;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());

    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
    }
  });

  it("should fail to process operations - deposit length  exceed maxDeposit", function () {
    body.deposits = Array.from({length: MAX_DEPOSITS + 1}, () => ssz.phase0.Deposit.defaultValue()) as List<
      phase0.Deposit
    >;

    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {}
  });

  it("should fail to process operations - voluntaryExit length  exceed maxVoluntaryExit", function () {
    processProposerSlashingStub.returns();
    processAttesterSlashingStub.returns();
    processAttestationStub.returns();
    processDepositStub.returns();
    body.voluntaryExits = Array.from({length: MAX_VOLUNTARY_EXITS + 1}, () =>
      ssz.phase0.SignedVoluntaryExit.defaultValue()
    ) as List<phase0.SignedVoluntaryExit>;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.eth1Data.depositCount++;

    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
      expect(processAttestationStub.calledOnce).to.be.true;
      expect(processDepositStub.calledOnce).to.be.true;
    }
  });

  it("should fail to process operations - transfer length  exceed maxTransfer", function () {
    processProposerSlashingStub.returns();
    processAttesterSlashingStub.returns();
    processAttestationStub.returns();
    processDepositStub.returns();
    processVoluntaryExitStub.returns();
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.eth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptySignedVoluntaryExit());

    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
      expect(processAttestationStub.calledOnce).to.be.true;
      expect(processDepositStub.calledOnce).to.be.true;
      expect(processVoluntaryExitStub.calledOnce).to.be.true;
    }
  });

  it("should  process operations ", function () {
    processProposerSlashingStub.returns();
    processAttesterSlashingStub.returns();
    processAttestationStub.returns();
    processDepositStub.returns();
    processVoluntaryExitStub.returns();
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.eth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptySignedVoluntaryExit());
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
      expect(processAttestationStub.calledOnce).to.be.true;
      expect(processDepositStub.calledOnce).to.be.true;
      expect(processVoluntaryExitStub.calledOnce).to.be.true;
    }
  });
});
