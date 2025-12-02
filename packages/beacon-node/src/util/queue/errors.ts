import {LodestarError} from "@lodestar/utils";

export enum QueueErrorCode {
  QUEUE_ABORTED = "QUEUE_ERROR_QUEUE_ABORTED",
  QUEUE_MAX_LENGTH = "QUEUE_ERROR_QUEUE_MAX_LENGTH",
}

export type QueueErrorCodeType = {code: QueueErrorCode.QUEUE_ABORTED} | {code: QueueErrorCode.QUEUE_MAX_LENGTH};

export class QueueError extends LodestarError<QueueErrorCodeType> {}

export function isQueueErrorAborted(e: unknown): e is QueueError {
  return e instanceof QueueError && e.type.code === QueueErrorCode.QUEUE_ABORTED;
}
