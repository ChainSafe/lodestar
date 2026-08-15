import {LinkedList} from "../../../util/array.js";

type NativeJob = {
  start(): void;
  reject(reason: Error): void;
};

/**
 * Bounds native-owned input snapshots while leaving headroom for critical work
 * to enter the native priority queue under normal load.
 */
export class NativeBlsScheduler {
  private readonly normalJobs = new LinkedList<NativeJob>();
  private readonly criticalJobs = new LinkedList<NativeJob>();
  private readonly criticalLimit: number;
  private inFlightJobs = 0;
  private closed = false;
  private closeError: Error | null = null;
  private closePromise: Promise<void> | null = null;
  private resolveClose: (() => void) | null = null;

  constructor(
    private readonly concurrency: number,
    private readonly onJobFinished: (sigCount: number, duration: number, queueWait: number) => void
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw Error(`Invalid native BLS executor concurrency ${concurrency}`);
    }

    // One executor-width of additional critical roots lets native workers
    // observe priority while keeping native-owned snapshots tightly bounded.
    this.criticalLimit = concurrency * 2;
  }

  get activeJobs(): number {
    return this.inFlightJobs;
  }

  get occupiedSlots(): number {
    return Math.min(this.inFlightJobs, this.concurrency);
  }

  get queuedJobs(): number {
    return this.normalJobs.length + this.criticalJobs.length;
  }

  get canAcceptNormalWork(): boolean {
    return !this.closed && this.inFlightJobs < this.concurrency;
  }

  schedule<T>(critical: boolean, sigCount: number, operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(this.closeError ?? Error("Native BLS scheduler is closed"));

    return new Promise<T>((resolve, reject) => {
      const queuedAt = process.hrtime.bigint();
      const job: NativeJob = {
        reject,
        start: () => {
          this.inFlightJobs++;
          const start = process.hrtime.bigint();
          const queueWait = Number(start - queuedAt) / 1e9;

          let promise: Promise<T>;
          try {
            promise = operation();
          } catch (error) {
            reject(error);
            this.finish(sigCount, start, queueWait);
            return;
          }

          promise.then(
            (result) => {
              resolve(result);
              this.finish(sigCount, start, queueWait);
            },
            (error: unknown) => {
              reject(error);
              this.finish(sigCount, start, queueWait);
            }
          );
        },
      };

      (critical ? this.criticalJobs : this.normalJobs).push(job);
      this.run();
    });
  }

  close(error: Error): Promise<void> {
    if (this.closed) return this.closePromise ?? Promise.resolve();
    this.closed = true;
    this.closeError = error;

    this.rejectQueued(this.criticalJobs, error);
    this.rejectQueued(this.normalJobs, error);
    if (this.inFlightJobs === 0) return Promise.resolve();

    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });
    return this.closePromise;
  }

  private run(): void {
    while (!this.closed) {
      if (this.inFlightJobs < this.criticalLimit) {
        const criticalJob = this.criticalJobs.shift();
        if (criticalJob) {
          criticalJob.start();
          continue;
        }
      }

      // Normal work may only occupy one executor-width. Check it after the
      // critical queue so critical roots can enter native under saturation.
      if (this.inFlightJobs < this.concurrency) {
        const normalJob = this.normalJobs.shift();
        if (normalJob) {
          normalJob.start();
          continue;
        }
      }

      return;
    }
  }

  private finish(sigCount: number, start: bigint, queueWait: number): void {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    this.inFlightJobs--;
    this.onJobFinished(sigCount, duration, queueWait);
    this.run();

    if (this.closed && this.inFlightJobs === 0) {
      this.resolveClose?.();
      this.resolveClose = null;
    }
  }

  private rejectQueued(jobs: LinkedList<NativeJob>, error: Error): void {
    for (const job of jobs) job.reject(error);
    jobs.clear();
  }
}
