export enum QueueType {
  FIFO = "FIFO",
  LIFO = "LIFO",
}

export type JobQueueOpts = {
  maxLength: number;
  /** Defaults to 1 */
  maxConcurrency?: number;
  /** Yield to the macro queue every at least every N milliseconds */
  yieldEveryMs?: number;
  signal: AbortSignal;
  /** Defaults to FIFO */
  type?: QueueType;
};

export const defaultQueueOpts: Required<Pick<JobQueueOpts, "maxConcurrency" | "yieldEveryMs" | "type">> = {
  maxConcurrency: 1,
  yieldEveryMs: 50,
  type: QueueType.FIFO,
};
