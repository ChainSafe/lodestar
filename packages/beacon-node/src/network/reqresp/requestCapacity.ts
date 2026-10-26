import {ErrorAborted, LodestarError, TimeoutError} from "@lodestar/utils";

export type RequestCapacityOptions = {signal: AbortSignal; timeoutMs: number};
export type WaitForRequestCapacity = (token: string, options: RequestCapacityOptions) => Promise<void>;

export class RequestCapacityError extends LodestarError<{
  code: "INVALID_REQUEST_CAPACITY_TOKEN" | "INVALID_REQUEST_CAPACITY_TIMEOUT" | "REQUEST_CAPACITY_WAITERS_FULL";
}> {}

type Waiter = {
  token: string;
  checking: boolean;
  dirty: boolean;
  finish(error?: unknown): void;
};

export class RequestCapacity {
  private readonly waiters = new Set<Waiter>();
  private closed = false;
  private scheduled: NodeJS.Immediate | undefined;

  constructor(private readonly watch: (token: string) => Promise<boolean>) {}

  async wait(token: string, {signal, timeoutMs}: RequestCapacityOptions): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new RequestCapacityError({code: "INVALID_REQUEST_CAPACITY_TIMEOUT"});
    if (this.closed || signal.aborted) throw new ErrorAborted("request capacity");
    if (this.waiters.size >= 32) throw new RequestCapacityError({code: "REQUEST_CAPACITY_WAITERS_FULL"});
    return new Promise((resolve, reject) => {
      const abort = (): void => waiter.finish(new ErrorAborted("request capacity"));
      const timer = setTimeout(() => waiter.finish(new TimeoutError("request capacity")), timeoutMs);
      const waiter: Waiter = {
        token,
        checking: false,
        dirty: false,
        finish: (error) => {
          if (!this.waiters.delete(waiter)) return;
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          if (error !== undefined) reject(error);
          else resolve();
        },
      };
      this.waiters.add(waiter);
      signal.addEventListener("abort", abort, {once: true});
      if (signal.aborted) abort();
      else void this.check(waiter);
    });
  }

  readonly changed = (): void => {
    for (const waiter of this.waiters) {
      if (waiter.checking) waiter.dirty = true;
      else void this.check(waiter);
    }
  };

  private async check(waiter: Waiter): Promise<void> {
    waiter.checking = true;
    waiter.dirty = false;
    try {
      if (await this.watch(waiter.token)) waiter.finish();
    } catch (error) {
      waiter.finish(error);
    } finally {
      waiter.checking = false;
      // A worker notification can overtake the reply to its earlier check.
      if (this.waiters.has(waiter) && waiter.dirty && this.scheduled === undefined) {
        this.scheduled = setImmediate(() => {
          this.scheduled = undefined;
          for (const pending of this.waiters) {
            if (pending.dirty && !pending.checking) void this.check(pending);
          }
        });
      }
    }
  }

  close(): void {
    this.closed = true;
    if (this.scheduled !== undefined) clearImmediate(this.scheduled);
    this.scheduled = undefined;
    for (const waiter of this.waiters) waiter.finish(new ErrorAborted("request capacity"));
  }
}
