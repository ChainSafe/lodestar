import {ExecutionStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimsticBlock(block: ProtoBlock): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}
