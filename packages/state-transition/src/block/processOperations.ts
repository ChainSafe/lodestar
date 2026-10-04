import {ForkSeq, MAX_ATTESTER_SLASHINGS_ELECTRA} from "@lodestar/params";
import {BeaconBlockBody, Slot, capella, decoupled, electra, gloas} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateDecoupled,
  CachedBeaconStateElectra,
  CachedBeaconStateGloas,
} from "../types.js";
import {getEth1DepositCount} from "../util/deposit.js";
import {processAttestations} from "./processAttestations.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processAttesterSlashing2} from "./processAttesterSlashing2.js";
import {processAvailableChainAttestation} from "./processAvailableChainAttestation.js";
import {processBlsToExecutionChange} from "./processBlsToExecutionChange.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";
import {processDeposit} from "./processDeposit.js";
import {processDepositRequest} from "./processDepositRequest.js";
import {processPayloadAttestation} from "./processPayloadAttestation.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";
import {processWithdrawalRequest} from "./processWithdrawalRequest.js";
import {ProcessBlockOpts, ProcessOperationsStep} from "./types.js";

export {
  processProposerSlashing,
  processAttesterSlashing,
  processAttestations,
  processDeposit,
  processVoluntaryExit,
  processWithdrawalRequest,
  processBlsToExecutionChange,
  processDepositRequest,
  processConsolidationRequest,
  processAvailableChainAttestation,
  processAttesterSlashing2,
};

export function processOperations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  body: BeaconBlockBody,
  parentSlot: Slot | null,
  opts: ProcessBlockOpts = {verifySignatures: true},
  metrics?: BeaconStateTransitionMetrics | null
): void {
  // verify that outstanding deposits are processed up to the maximum number of deposits.
  // From Fulu the eth1 bridge deposit mechanism was removed, so blocks must not contain any deposits.
  const maxDeposits = fork >= ForkSeq.fulu ? 0 : getEth1DepositCount(state);
  if (body.deposits.length !== maxDeposits) {
    throw new Error(
      `Block contains incorrect number of deposits: depositCount=${body.deposits.length} expected=${maxDeposits}`
    );
  }

  {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processProposerSlashing});
    for (const proposerSlashing of body.proposerSlashings) {
      processProposerSlashing(fork, state, proposerSlashing, opts.verifySignatures);
    }
    timer?.();
  }

  {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processAttesterSlashing});
    for (const attesterSlashing of body.attesterSlashings) {
      processAttesterSlashing(fork, state, attesterSlashing, opts.verifySignatures);
    }
    timer?.();
  }

  {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processAttestations});
    processAttestations(fork, state, body.attestations, parentSlot, opts.verifySignatures, metrics);
    timer?.();
  }

  {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processDeposit});
    for (const deposit of body.deposits) {
      processDeposit(fork, state, deposit);
    }
    timer?.();
  }

  {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processVoluntaryExit});
    for (const voluntaryExit of body.voluntaryExits) {
      processVoluntaryExit(fork, state, voluntaryExit, opts.verifySignatures);
    }
    timer?.();
  }

  if (fork >= ForkSeq.capella) {
    const timer = metrics?.processOperationsStepTime.startTimer({
      step: ProcessOperationsStep.processBlsToExecutionChange,
    });
    for (const blsToExecutionChange of (body as capella.BeaconBlockBody).blsToExecutionChanges) {
      processBlsToExecutionChange(state as CachedBeaconStateCapella, blsToExecutionChange);
    }
    timer?.();
  }

  if (fork >= ForkSeq.electra && fork < ForkSeq.gloas) {
    const stateElectra = state as CachedBeaconStateElectra;
    const bodyElectra = body as electra.BeaconBlockBody;

    {
      const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processDepositRequest});
      for (const depositRequest of bodyElectra.executionRequests.deposits) {
        processDepositRequest(fork, stateElectra, depositRequest);
      }
      timer?.();
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({
        step: ProcessOperationsStep.processWithdrawalRequest,
      });
      for (const elWithdrawalRequest of bodyElectra.executionRequests.withdrawals) {
        processWithdrawalRequest(fork, stateElectra, elWithdrawalRequest);
      }
      timer?.();
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({
        step: ProcessOperationsStep.processConsolidationRequest,
      });
      for (const elConsolidationRequest of bodyElectra.executionRequests.consolidations) {
        processConsolidationRequest(stateElectra, elConsolidationRequest);
      }
      timer?.();
    }
  }

  if (fork >= ForkSeq.gloas) {
    const timer = metrics?.processOperationsStepTime.startTimer({
      step: ProcessOperationsStep.processPayloadAttestation,
    });
    for (const payloadAttestation of (body as gloas.BeaconBlockBody).payloadAttestations) {
      processPayloadAttestation(state as CachedBeaconStateGloas, payloadAttestation, opts.verifySignatures);
    }
    timer?.();
  }

  // Spec: process_operations [Modified in DC] (decoupled-consensus/beacon-chain.md)
  if (fork >= ForkSeq.decoupled) {
    const stateDecoupled = state as CachedBeaconStateDecoupled;
    const bodyDecoupled = body as decoupled.BeaconBlockBody;
    if (bodyDecoupled.attesterSlashings2.length > MAX_ATTESTER_SLASHINGS_ELECTRA) {
      throw new Error(`Block contains too many attester slashings 2: ${bodyDecoupled.attesterSlashings2.length}`);
    }
    if (parentSlot === null) {
      throw new Error("Must supply parentSlot post-decoupled");
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({
        step: ProcessOperationsStep.processAvailableChainAttestation,
      });
      for (const attestation of bodyDecoupled.availableChainAttestations) {
        processAvailableChainAttestation(stateDecoupled, attestation, parentSlot, opts.verifySignatures);
      }
      timer?.();
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({
        step: ProcessOperationsStep.processAttesterSlashing2,
      });
      for (const attesterSlashing of bodyDecoupled.attesterSlashings2) {
        processAttesterSlashing2(stateDecoupled, attesterSlashing, opts.verifySignatures);
      }
      timer?.();
    }
  }
}
