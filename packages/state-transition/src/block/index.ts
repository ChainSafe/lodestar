import {ForkPostGloas, ForkSeq} from "@lodestar/params";
import {BeaconBlock, BlindedBeaconBlock, altair, capella} from "@lodestar/types";
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
import {processExecutionPayloadBid} from "./processExecutionPayloadBid.ts";
import {processExecutionPayloadEnvelope} from "./processExecutionPayloadEnvelope.ts";
import {processOperations} from "./processOperations.js";
import {processPayloadAttestation} from "./processPayloadAttestation.ts";
import {processRandao} from "./processRandao.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processWithdrawals} from "./processWithdrawals.js";
import {ProcessBlockOpts, ProposerRewardType} from "./types.js";

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
  processExecutionPayloadEnvelope,
};

export * from "./externalData.js";
export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";
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

  processBlockHeader(state, block);

  if (fork >= ForkSeq.gloas) {
    // After gloas, processWithdrawals does not take a payload parameter
    processWithdrawals(fork, state as CachedBeaconStateGloas);
  } else if (fork >= ForkSeq.capella) {
    const fullOrBlindedPayload = getFullOrBlindedPayload(block);
    processWithdrawals(
      fork,
      state as CachedBeaconStateCapella,
      fullOrBlindedPayload as capella.FullOrBlindedExecutionPayload
    );
  }

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  // TODO GLOAS: We call processExecutionPayload somewhere else post-gloas
  if (
    fork < ForkSeq.gloas &&
    fork >= ForkSeq.bellatrix &&
    isExecutionEnabled(state as CachedBeaconStateBellatrix, block)
  ) {
    processExecutionPayload(fork, state as CachedBeaconStateBellatrix, block.body, externalData);
  }

  if (fork >= ForkSeq.gloas) {
    processExecutionPayloadBid(state as CachedBeaconStateGloas, block as BeaconBlock<ForkPostGloas>);
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(fork, state, block.body, opts, metrics);
  if (fork >= ForkSeq.altair) {
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
  }

  if (fork >= ForkSeq.deneb) {
    processBlobKzgCommitments(externalData);
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
