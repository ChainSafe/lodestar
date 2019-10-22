import {expect} from "chai";
import sinon from "sinon";
import {hashTreeRoot} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {Crosslink} from "@chainsafe/eth2.0-types";
import  * as processProposerSlashing
  from "../../../../../../eth2.0-state-transition/src/block/operations/proposerSlashing";
import  * as processAttesterSlashing
  from "../../../../../../eth2.0-state-transition/src/block/operations/attesterSlashing";
import  * as processAttestation
  from "../../../../../../eth2.0-state-transition/src/block/operations/attestation";
import  * as processDeposit
  from "../../../../../../eth2.0-state-transition/src/block/operations/deposit";
import  * as processVoluntaryExit
  from "../../../../../../eth2.0-state-transition/src/block/operations/voluntaryExit";
import  * as processTransfer
  from "../../../../../../eth2.0-state-transition/src/block/operations/transfer";
import {processOperations} from "../../../../../../eth2.0-state-transition/src/block/operations";

import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateDeposit} from "../../../../utils/deposit";
import {generateEmptyTransfer} from "../../../../utils/transfer";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../../utils/slashings";
import {generateAttestationData, generateEmptyAttestation} from "../../../../utils/attestation";
import {generateEmptyVoluntaryExit} from "../../../../utils/voluntaryExits";


describe('process block - process operations', function () {

  const sandbox = sinon.createSandbox();

  let processProposerSlashingStub: any,
    processAttesterSlashingStub: any,
    processAttestationStub: any,
    processDepositStub: any,
    processVoluntaryExitStub: any,
    processTransferStub: any;

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
      processOperations(config, state, body);
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
      processOperations(config, state, body);
      expect.fail();
    }catch (e) {

    }
  });

  it('should fail to process operations - proposerSlashings length  exceed maxProposerSlashings ', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    body.proposerSlashings.length = config.params.MAX_PROPOSER_SLASHINGS + 1;
    try {
      processOperations(config, state, body);
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process operations - attesterSlashings length  exceed maxAttesterSlashings', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    body.attesterSlashings.length = config.params.MAX_ATTESTER_SLASHINGS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    try {
      processOperations(config, state, body);
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
    body.attestations.length = config.params.MAX_ATTESTATIONS + 1;
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

  it('should fail to process operations - deposit length  exceed maxDeposit', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    body.deposits.length = config.params.MAX_DEPOSITS + 1;

    try {
      processOperations(config, state, body);
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
    body.voluntaryExits.length = config.params.MAX_VOLUNTARY_EXITS + 1;
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

  it('should fail to process operations - transfer length  exceed maxTransfer', function () {
    const state = generateState();
    const body = generateEmptyBlock().body;
    processProposerSlashingStub.returns(0);
    processAttesterSlashingStub.returns(0);
    processAttestationStub.returns(0);
    processDepositStub.returns(0);
    processVoluntaryExitStub.returns(0);
    body.transfers.length = config.params.MAX_TRANSFERS + 1;
    body.proposerSlashings.push(generateEmptyProposerSlashing());
    body.attesterSlashings.push(generateEmptyAttesterSlashing());
    body.attestations.push(generateEmptyAttestation());
    body.deposits.push(generateDeposit());
    state.eth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptyVoluntaryExit());

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
    state.eth1Data.depositCount++;
    body.voluntaryExits.push(generateEmptyVoluntaryExit());
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
