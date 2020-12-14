import {AbortSignal} from "abort-controller";
import pushable, {Pushable} from "it-pushable";
import pipe from "it-pipe";

export enum QueueErrorCode {
  ERR_QUEUE_ABORTED = "ERR_QUEUE_ABORTED",
  ERR_QUEUE_THROTTLED = "ERR_QUEUE_THROTTLED",
}

export class QueueError extends Error {
  code: QueueErrorCode;
  constructor(code: QueueErrorCode, msg?: string) {
    super(msg || code);
    this.code = code;
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
      reject(new QueueError(QueueErrorCode.ERR_QUEUE_ABORTED));
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
      throw new QueueError(QueueErrorCode.ERR_QUEUE_ABORTED);
    }
    if (this.currentSize + 1 > this.queueSize) {
      throw new QueueError(QueueErrorCode.ERR_QUEUE_THROTTLED);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({job, resolve, reject});
      this.currentSize++;
    });
  }
}
