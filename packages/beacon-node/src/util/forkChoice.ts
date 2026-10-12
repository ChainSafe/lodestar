import {ExecutionStatus, IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimisticBlock(block: ProtoBlock): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}

/**
 * Record the inclusion list verdict a forkchoiceUpdated response carries for the payload with the
 * submitted block hash: `head`'s own payload when `head` is its FULL variant, otherwise the payload of
 * the closest ancestor carrying that hash. Returns whether the recorded verdict changed.
 */
export function recordHeadPayloadInclusionListVerdict(
  forkChoice: IForkChoice,
  head: ProtoBlock | null,
  inclusionListSatisfied: boolean | null
): boolean {
  if (inclusionListSatisfied === null || head === null || head.executionPayloadBlockHash === null) {
    return false;
  }
  let payloadBlock: ProtoBlock | null = head;
  while (payloadBlock !== null && payloadBlock.payloadStatus !== PayloadStatus.FULL) {
    payloadBlock = forkChoice.getBlockHexAndBlockHash(payloadBlock.parentRoot, head.executionPayloadBlockHash);
  }
  if (payloadBlock === null) {
    return false;
  }
  return forkChoice.recordPayloadInclusionListSatisfaction(payloadBlock.blockRoot, inclusionListSatisfied);
}
