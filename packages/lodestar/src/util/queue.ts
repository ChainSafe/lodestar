import {AbortSignal} from "abort-controller";
import pushable, {Pushable} from "it-pushable";
import pipe from "it-pipe";
import {LodestarError} from "@chainsafe/lodestar-utils";

export enum QueueErrorCode {
  QUEUE_ABORTED = "QUEUE_ERROR_QUEUE_ABORTED",
  QUEUE_THROTTLED = "QUEUE_ERROR_QUEUE_THROTTLED",
}

export type QueueErrorCodeType = {code: QueueErrorCode.QUEUE_ABORTED} | {code: QueueErrorCode.QUEUE_THROTTLED};

export class QueueError extends LodestarError<QueueErrorCodeType> {
  constructor(type: QueueErrorCodeType) {
    super(type);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Job = (...args: any) => any;

type JobQueueItem<T extends Job = Job> = {
  job: T;
  resolve: (value?: ReturnType<T> | PromiseLike<ReturnType<T>> | undefined) => void;
  reject: (reason?: unknown) => void;
};

export class JobQueue {
  queueSize: number;
  currentSize: number;
  signal: AbortSignal;
  queue: Pushable<JobQueueItem>;
  processor: Promise<void>;
  constructor({queueSize, signal}: {queueSize: number; signal: AbortSignal}) {
    this.queueSize = queueSize;
    this.currentSize = 0;
    this.signal = signal;
    this.queue = pushable();
    this.processor = pipe(this.queue, async (source) => {
      for await (const job of source) {
        await this.processJob(job);
      }
    });
  }

  async processJob({job, resolve, reject}: JobQueueItem): Promise<void> {
    if (this.signal.aborted) {
      reject(new QueueError({code: QueueErrorCode.QUEUE_ABORTED}));
    } else {
      try {
        const result = await job();
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }
    this.currentSize--;
  }

  async enqueueJob<T extends Job>(job: T): Promise<ReturnType<T>> {
    if (this.signal.aborted) {
      throw new QueueError({code: QueueErrorCode.QUEUE_ABORTED});
    }
    if (this.currentSize + 1 > this.queueSize) {
      throw new QueueError({code: QueueErrorCode.QUEUE_THROTTLED});
    }
    return new Promise((resolve, reject) => {
      this.queue.push({job, resolve, reject});
      this.currentSize++;
    });
  }
}
