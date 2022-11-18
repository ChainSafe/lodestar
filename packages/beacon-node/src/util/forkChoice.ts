import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimisticBlock(block: ProtoBlock): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}
