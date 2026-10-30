import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";

export function isOptimisticBlock(block: Pick<ProtoBlock, "executionStatus">): boolean {
  return block.executionStatus === ExecutionStatus.Syncing;
}

export function toForkChoiceValidity(status: ExecutionStatus): "valid" | "invalid" | "optimistic" {
  switch (status) {
    case ExecutionStatus.Valid:
      return "valid";
    case ExecutionStatus.Invalid:
      return "invalid";
    case ExecutionStatus.Syncing:
    case ExecutionStatus.PreMerge:
      return "optimistic";
  }
}

export function toPayloadStatusName(status: PayloadStatus): "pending" | "empty" | "full" {
  switch (status) {
    case PayloadStatus.PENDING:
      return "pending";
    case PayloadStatus.EMPTY:
      return "empty";
    case PayloadStatus.FULL:
      return "full";
  }
}
