import {ForkPostGloas, ForkSeq} from "@lodestar/params";
import {BeaconBlock, BlindedBeaconBlock, Slot, altair, capella} from "@lodestar/types";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateGloas,
} from "../types.js";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {BlockExternalData, DataAvailabilityStatus} from "./externalData.js";
import {processBlobKzgCommitments} from "./processBlobKzgCommitments.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processExecutionPayloadBid} from "./processExecutionPayloadBid.js";
import {processOperations} from "./processOperations.js";
import {processParentExecutionPayload} from "./processParentExecutionPayload.js";
import {processPayloadAttestation} from "./processPayloadAttestation.js";
import {processRandao} from "./processRandao.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processWithdrawals} from "./processWithdrawals.js";
import {BlockProcessStep, ProcessBlockOpts, ProposerRewardType} from "./types.js";

// Spec tests
export {
  processBlockHeader,
  processExecutionPayload,
  processRandao,
  processEth1Data,
  processSyncAggregate,
  processWithdrawals,
  processExecutionPayloadBid,
  processPayloadAttestation,
  processParentExecutionPayload,
};

export * from "./externalData.js";
export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";
export * from "./processBuilderDepositRequest.js";
export * from "./processBuilderExitRequest.js";
export * from "./processDepositRequest.js";
export * from "./processOperations.js";

export function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: BeaconBlock | BlindedBeaconBlock,
  externalData: BlockExternalData & ProcessBlockOpts,
  opts?: ProcessBlockOpts,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  const {verifySignatures = true} = opts ?? {};

  // Capture the parent block's slot before processBlockHeader overwrites latestBlockHeader
  const parentSlot: Slot | null =
    fork >= ForkSeq.gloas ? (state as CachedBeaconStateGloas).latestBlockHeader.slot : null;

  // Apply the parent's deferred payload effects before everything else. Must run before
  // processBlockHeader and processExecutionPayloadBid so subsequent steps see the updated state.
  if (fork >= ForkSeq.gloas) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processParentExecutionPayload});
    processParentExecutionPayload(state as CachedBeaconStateGloas, block as BeaconBlock<ForkPostGloas>);
    timer?.();
  }

  {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processBlockHeader});
    processBlockHeader(state, block);
    timer?.();
  }

  if (fork >= ForkSeq.capella) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processWithdrawals});
    if (fork >= ForkSeq.gloas) {
      // Parent payload's execution requests were already applied by processParentExecutionPayload above
      processWithdrawals(fork, state as CachedBeaconStateGloas);
    } else {
      const fullOrBlindedPayload = getFullOrBlindedPayload(block);
      processWithdrawals(
        fork,
        state as CachedBeaconStateCapella,
        fullOrBlindedPayload as capella.FullOrBlindedExecutionPayload
      );
    }
    timer?.();
  }

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  // Post-gloas: process_execution_payload is not part of block processing. The parent's payload
  // effects are applied earlier via processParentExecutionPayload, and each execution payload is
  // verified out-of-band via verifyExecutionPayloadEnvelope when it arrives.
  if (
    fork < ForkSeq.gloas &&
    fork >= ForkSeq.bellatrix &&
    isExecutionEnabled(state as CachedBeaconStateBellatrix, block)
  ) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processExecutionPayload});
    processExecutionPayload(fork, state as CachedBeaconStateBellatrix, block.body, externalData);
    timer?.();
  }

  if (fork >= ForkSeq.gloas) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processExecutionPayloadBid});
    processExecutionPayloadBid(
      state as CachedBeaconStateGloas,
      (block as BeaconBlock<ForkPostGloas>).body.signedExecutionPayloadBid
    );
    timer?.();
  }

  {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processRandao});
    processRandao(state, block, verifySignatures);
    timer?.();
  }

  {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processEth1Data});
    processEth1Data(state, block.body.eth1Data);
    timer?.();
  }

  {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processOperations});
    processOperations(fork, state, block.body, parentSlot, opts, metrics);
    timer?.();
  }

  if (fork >= ForkSeq.altair) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processSyncAggregate});
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
    timer?.();
  }

  if (fork >= ForkSeq.deneb) {
    const timer = metrics?.processBlockStepTime.startTimer({step: BlockProcessStep.processBlobKzgCommitments});
    processBlobKzgCommitments(externalData);
    timer?.();
    // Only throw PreData so beacon can also sync/process blocks optimistically
    // and let forkChoice handle it
    if (externalData.dataAvailabilityStatus === DataAvailabilityStatus.PreData) {
      throw Error("dataAvailabilityStatus.PreData");
    }
  }

  const rewards = state.proposerRewards;
  metrics?.proposerRewards.set({type: ProposerRewardType.attestation}, rewards.attestations);
  metrics?.proposerRewards.set({type: ProposerRewardType.syncAggregate}, rewards.syncAggregate);
  metrics?.proposerRewards.set({type: ProposerRewardType.slashing}, rewards.slashing);
}
