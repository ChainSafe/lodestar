import {EventEmitter} from "events";

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

/**
 * EventEmitter-based job queue
 */
export class JobQueue extends EventEmitter {
  private finished: number;
  private next: number;
  private queueSize: number;
  private signal: AbortSignal;

  constructor({queueSize, signal}: {queueSize: number; signal: AbortSignal}) {
    super();
    this.finished = 0;
    this.next = 0;
    this.queueSize = queueSize;
    this.signal = signal;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async enqueueJob<T extends (...args: any) => any>(job: T): Promise<ReturnType<T>> {
    const id = await this.startJob();
    try {
      const result = await job();
      await this.finishJob(id);
      return result;
    } catch (e) {
      await this.finishJob(id);
      throw e;
    }
  }

  async startJob(): Promise<number> {
    if (this.signal.aborted) {
      throw new QueueError(QueueErrorCode.ERR_QUEUE_ABORTED);
    }
    if (this.next + 1 - this.finished > this.queueSize) {
      throw new QueueError(QueueErrorCode.ERR_QUEUE_THROTTLED);
    }
    const prev = this.next;
    this.next++;
    const id = this.next;
    // the job should start right away if there are no outstanding jobs
    if (prev === this.finished) {
      return id;
    }
    // otherwise wait for the previous job to complete
    return await new Promise((resolve, reject) => {
      const abortHandler = (): void => {
        this.removeAllListeners(prev.toString());
        reject(new QueueError(QueueErrorCode.ERR_QUEUE_ABORTED));
      };
      this.once(prev.toString(), () => {
        this.signal.removeEventListener("abort", abortHandler);
        resolve(id);
      });
      this.signal.addEventListener("abort", abortHandler, {once: true});
    });
  }

  async finishJob(id: number): Promise<void> {
    this.finished = id;
    this.emit(id.toString());
  }
}
