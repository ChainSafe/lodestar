import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimisticBlock(block: Pick<ProtoBlock, "executionStatus">): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}
