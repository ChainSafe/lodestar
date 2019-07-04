import {expect} from "chai";
import sinon from "sinon";
import {hashTreeRoot} from "@chainsafe/ssz";

import {Crosslink} from "../../../../../../../types";
import  * as processProposerSlashing
  from "../../../../../../chain/stateTransition/block/operations/proposerSlashing";
import  * as processAttesterSlashing
  from "../../../../../../chain/stateTransition/block/operations/attesterSlashing";
import  * as processAttestation
  from "../../../../../../chain/stateTransition/block/operations/attestation";
import  * as processDeposit
  from "../../../../../../chain/stateTransition/block/operations/deposit";
import  * as processVoluntaryExit
  from "../../../../../../chain/stateTransition/block/operations/voluntaryExit";
import  * as processTransfer
  from "../../../../../../chain/stateTransition/block/operations/transfer";

import {processOperations} from "../../../../../../chain/stateTransition/block/operations";
import {generateState} from "../../../../../utils/state";
import {generateEmptyBlock} from "../../../../../utils/block";
import {generateDeposit} from "../../../../../utils/deposit";
import {generateEmptyTransfer} from "../../../../../utils/transfer";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_DEPOSITS,
  MAX_PROPOSER_SLASHINGS, MAX_VOLUNTARY_EXITS
} from "../../../../../../constants";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../../utils/slashings";
import {generateAttestationData, generateEmptyAttestation} from "../../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../../utils/voluntaryExits";
import {MAX_TRANSFERS} from "../../../../../../constants/minimal";


describe('process block - process operations', function () {

  const sandbox = sinon.createSandbox();

  let processProposerSlashingStub,
    processAttesterSlashingStub,
    processAttestationStub,
    processDepositStub,
    processVoluntaryExitStub,
    processTransferStub;

  beforeEach(() => {
    processProposerSlashingStub = sandbox.stub(processProposerSlashing, "processProposerSlashing");
    processAttesterSlashingStub = sandbox.stub(processAttesterSlashing, "processAttesterSlashing");
    processAttestationStub = sandbox.stub(processAttestation, "processAttestation");
    processDepositStub = sandbox.stub(processDeposit, "processDeposit");
    processVoluntaryExitStub = sandbox.stub(processVoluntaryExit, "processVoluntaryExit");
    processTransferStub = sandbox.stub(processTransfer, "processTransfer");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail to process operations - outstanding deposits not processed up to the maximum', function () {
    const state  = generateState();
    const body = generateEmptyBlock().body;
    body.deposits.push(generateDeposit());
    try {
      processOperations(state, body);
      expect.fail();
    }catch (e) {

    }

  });

  it('should fail to process operations - duplicate transfers', function () {
    const state  = generateState();
    const body = generateEmptyBlock().body;
    body.transfers.push(generateEmptyTransfer());
    body.transfers.push(generateEmptyTransfer());
    try {
      processOperations(state, body);
      expect.fail();
    }catch (e) {

    }
  });

  it('should fail to process operations - proposerSlashings length  exceed maxProposerSlashings ', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    body.proposerSlashings.length = MAX_PROPOSER_SLASHINGS + 1;
    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process operations - attesterSlashings length  exceed maxAttesterSlashings', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    body.attesterSlashings.length = MAX_ATTESTER_SLASHINGS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process operations - attestation length  exceed maxAttestation', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    processAttesterSlashingStub.returns(0);
    body.attestations.length = MAX_ATTESTATIONS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());

    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
    }

  });

  it('should fail to process operations - deposit length  exceed maxDeposit', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    body.deposits.length = MAX_DEPOSITS + 1;

    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {
    }

  });

  it('should fail to process operations - voluntaryExit length  exceed maxVoluntaryExit', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    processAttesterSlashingStub.returns(0);
    processAttestationStub.returns(0);
    processDepositStub.returns(0);
    body.voluntaryExits.length = MAX_VOLUNTARY_EXITS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.latestEth1Data.depositCount++;

    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
      expect(processAttestationStub.calledOnce).to.be.true;
      expect(processDepositStub.calledOnce).to.be.true;
    }
  });

  it('should fail to process operations - transfer length  exceed maxTransfer', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    processAttesterSlashingStub.returns(0);
    processAttestationStub.returns(0);
    processDepositStub.returns(0);
    processVoluntaryExitStub.returns(0);
    body.transfers.length = MAX_TRANSFERS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.latestEth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptyVoluntaryExit());

    try {
      processOperations(state, body);
      expect.fail();
    } catch (e) {
      expect(processProposerSlashingStub.calledOnce).to.be.true;
      expect(processAttesterSlashingStub.calledOnce).to.be.true;
      expect(processAttestationStub.calledOnce).to.be.true;
      expect(processDepositStub.calledOnce).to.be.true;
      expect(processVoluntaryExitStub.calledOnce).to.be.true;
    }
  });

  it('should  process operations ', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    processAttesterSlashingStub.returns(0);
    processAttestationStub.returns(0);
    processDepositStub.returns(0);
    processVoluntaryExitStub.returns(0);
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.latestEth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptyVoluntaryExit());
    try {
      processOperations(state, body);
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
