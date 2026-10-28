import {setImmediate as yieldToIO} from "node:timers/promises";
import {NativeNetwork, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {ErrorAborted} from "@lodestar/utils";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";

const ADMISSION_TIMEOUT_MS = 60000;

/** Retries only native admission refusals, which cannot have sent a request or delivered a response. */
export class NativeRequestAdmission implements AsyncIterableIterator<NativeResponseChunk> {
  private readonly controller = new AbortController();
  private readonly deadline = performance.now() + ADMISSION_TIMEOUT_MS;
  private iterator: AsyncIterableIterator<NativeResponseChunk> | undefined;
  private token: string | undefined;
  private received = false;
  private pulling = false;

  constructor(
    private readonly network: Pick<NativeNetwork, "request" | "waitForRequestCapacity">,
    private readonly args: Parameters<NativeNetwork["request"]>
  ) {
    this.start();
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<NativeResponseChunk> {
    return this;
  }

  async next(): Promise<IteratorResult<NativeResponseChunk>> {
    if (this.controller.signal.aborted) return {done: true, value: undefined};
    if (this.pulling) throw Object.assign(new Error("NetworkRequestBusy"), {code: "NetworkRequestBusy"});
    this.pulling = true;
    try {
      for (;;) {
        if (this.token !== undefined) {
          await this.wait(this.token);
          this.start();
        }
        if (!this.iterator) continue;
        try {
          const result = await this.iterator.next();
          if (this.controller.signal.aborted) throw new ErrorAborted("request admission");
          this.received = true;
          return result;
        } catch (error) {
          const token = capacityToken(error);
          if (this.received || token === undefined) throw error;
          this.iterator = undefined;
          this.token = token;
        }
      }
    } catch (error) {
      this.controller.abort();
      throw error;
    } finally {
      this.pulling = false;
    }
  }

  return(): Promise<IteratorResult<NativeResponseChunk>> {
    this.controller.abort();
    return this.iterator?.return?.() ?? Promise.resolve({done: true, value: undefined});
  }

  throw(error?: unknown): Promise<IteratorResult<NativeResponseChunk>> {
    this.controller.abort();
    return this.iterator?.throw?.(error) ?? Promise.reject(error);
  }

  private start(): void {
    this.token = undefined;
    try {
      this.iterator = this.network.request(...this.args);
    } catch (error) {
      const token = capacityToken(error);
      if (token === undefined) throw error;
      this.token = token;
    }
  }

  private async wait(token: string): Promise<void> {
    const signal = this.controller.signal;
    try {
      await this.network.waitForRequestCapacity(token, {signal, timeoutMs: this.remaining()});
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "NetworkRequestCapacityTimeout")
        throw admissionTimeout();
      throw error;
    }
    // A release grants no reservation. Yield so competing retries cannot starve native settlements.
    await yieldToIO(undefined, {signal});
    if (signal.aborted) throw new ErrorAborted("request admission");
    this.remaining();
  }

  private remaining(): number {
    const remaining = Math.floor(this.deadline - performance.now());
    if (remaining < 1) throw admissionTimeout();
    return remaining;
  }
}

function admissionTimeout(): NativeNetworkError {
  return new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "request admission timeout"});
}

function capacityToken(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "NetworkRequestRejected" &&
    "reason" in error &&
    error.reason === "local_capacity" &&
    "capacityToken" in error &&
    typeof error.capacityToken === "string"
  )
    return error.capacityToken;
  return undefined;
}
