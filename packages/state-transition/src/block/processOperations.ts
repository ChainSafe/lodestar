import {ForkPreEip8453, ForkPreHeze, ForkSeq} from "@lodestar/params";
import {BeaconBlockBody, Slot, capella, eip8453, electra, gloas} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateEip8453,
  CachedBeaconStateElectra,
  CachedBeaconStateGloas,
  CachedBeaconStatePreHeze,
} from "../types.js";
import {getEth1DepositCount} from "../util/deposit.js";
import {processAttestations} from "./processAttestations.js";
import {processAttestationsEip8453} from "./processAttestationsEip8453.js";
import {processAttesterSlashing, processLegacyAttesterSlashing} from "./processAttesterSlashing.js";
import {processBlsToExecutionChange} from "./processBlsToExecutionChange.js";
import {processConsolidationRequest} from "./processConsolidationRequest.js";
import {processDeposit} from "./processDeposit.js";
import {processDepositRequest} from "./processDepositRequest.js";
import {HeadVoteCommitteeCache, processHeadVote} from "./processHeadVote.js";
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
  if (fork < ForkSeq.heze) {
    // From Fulu the eth1 bridge deposit mechanism was removed, so blocks must not contain any deposits.
    const deposits = (body as BeaconBlockBody<ForkPreHeze>).deposits;
    const maxDeposits = fork >= ForkSeq.fulu ? 0 : getEth1DepositCount(state as CachedBeaconStatePreHeze);
    if (deposits.length !== maxDeposits) {
      throw new Error(
        `Block contains incorrect number of deposits: depositCount=${deposits.length} expected=${maxDeposits}`
      );
    }
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

  if (fork >= ForkSeq.eip8453) {
    const stateEip8453 = state as CachedBeaconStateEip8453;
    const bodyEip8453 = body as eip8453.BeaconBlockBody;

    // [New in EIP8453] a support bit may only be set on a vote of the previous slot
    if (bodyEip8453.headVoteSupportBits.bitLen !== bodyEip8453.headVotes.length) {
      throw Error(
        `Head vote support bits length ${bodyEip8453.headVoteSupportBits.bitLen} != head votes ${bodyEip8453.headVotes.length}`
      );
    }
    for (const voteIndex of bodyEip8453.headVoteSupportBits.getTrueBitIndexes()) {
      if (bodyEip8453.headVotes[voteIndex].data.slot !== state.slot - 1) {
        throw Error(`Supported head vote ${voteIndex} is not of the previous slot`);
      }
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({
        step: ProcessOperationsStep.processAttesterSlashing,
      });
      for (const attesterSlashing of bodyEip8453.legacyAttesterSlashings) {
        processLegacyAttesterSlashing(stateEip8453, attesterSlashing, opts.verifySignatures);
      }
      timer?.();
    }

    {
      const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processAttestations});
      processAttestationsEip8453(stateEip8453, bodyEip8453.attestations, opts.verifySignatures);
      timer?.();
    }
  } else {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processAttestations});
    processAttestations(
      fork,
      state,
      (body as BeaconBlockBody<ForkPreEip8453>).attestations,
      parentSlot,
      opts.verifySignatures,
      metrics
    );
    timer?.();
  }

  if (fork < ForkSeq.heze) {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processDeposit});
    for (const deposit of (body as BeaconBlockBody<ForkPreHeze>).deposits) {
      processDeposit(fork, state as CachedBeaconStatePreHeze, deposit);
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

  if (fork >= ForkSeq.eip8453) {
    const timer = metrics?.processOperationsStepTime.startTimer({step: ProcessOperationsStep.processHeadVote});
    const committeeCache: HeadVoteCommitteeCache = new Map();
    for (const headVote of (body as eip8453.BeaconBlockBody).headVotes) {
      processHeadVote(state as CachedBeaconStateEip8453, headVote, committeeCache, opts.verifySignatures);
    }
    timer?.();
  }
}
