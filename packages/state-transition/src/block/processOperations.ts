import {
  ForkSeq,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  MAX_BLS_TO_EXECUTION_CHANGES,
  MAX_PAYLOAD_ATTESTATIONS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@lodestar/params";
import {BeaconBlockBody, Slot, capella, electra, gloas} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateElectra,
  CachedBeaconStateGloas,
} from "../types.js";
import {getEth1DepositCount} from "../util/deposit.js";
import {processAttestations} from "./processAttestations.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
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
};

export function processOperations(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  body: BeaconBlockBody,
  parentSlot: Slot | null,
  opts: ProcessBlockOpts = {verifySignatures: true},
  metrics?: BeaconStateTransitionMetrics | null
): void {
  if (fork >= ForkSeq.gloas) {
    assertGloasOperationLimits(body as gloas.BeaconBlockBody);
  }

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
      processPayloadAttestation(state as CachedBeaconStateGloas, payloadAttestation);
    }
    timer?.();
  }
}

function assertGloasOperationLimits(body: gloas.BeaconBlockBody): void {
  assertMaxLength("proposerSlashings", body.proposerSlashings.length, MAX_PROPOSER_SLASHINGS);
  assertMaxLength("attesterSlashings", body.attesterSlashings.length, MAX_ATTESTER_SLASHINGS_ELECTRA);
  assertMaxLength("attestations", body.attestations.length, MAX_ATTESTATIONS_ELECTRA);
  assertMaxLength("voluntaryExits", body.voluntaryExits.length, MAX_VOLUNTARY_EXITS);
  assertMaxLength("blsToExecutionChanges", body.blsToExecutionChanges.length, MAX_BLS_TO_EXECUTION_CHANGES);
  assertMaxLength("payloadAttestations", body.payloadAttestations.length, MAX_PAYLOAD_ATTESTATIONS);
}

function assertMaxLength(name: string, length: number, limit: number): void {
  if (length > limit) {
    throw new Error(`Block contains too many ${name}: count=${length} limit=${limit}`);
  }
}
