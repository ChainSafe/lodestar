import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimisticBlock(block: ProtoBlock): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}

/**
 * Record the inclusion list verdict a forkchoiceUpdated response carries for its head payload. The
 * verdict describes the payload with the submitted block hash, which is `head`'s own payload only
 * when `head` is its FULL variant; an EMPTY or PENDING variant carries an ancestor's hash, whose
 * recorded verdict stays unchanged. Returns whether the recorded verdict changed.
 */
export function recordHeadPayloadInclusionListVerdict(
  forkChoice: IForkChoice,
  head: ProtoBlock | null,
  inclusionListSatisfied: boolean | null
): boolean {
  if (inclusionListSatisfied === null || head === null || head.payloadStatus !== PayloadStatus.FULL) {
    return false;
  }
  return forkChoice.recordPayloadInclusionListSatisfaction(head.blockRoot, inclusionListSatisfied);
}
