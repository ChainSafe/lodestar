import {RequestError, RequestErrorCode} from "@lodestar/reqresp";
import {TimeoutError} from "@lodestar/utils";
import {WaitForRequestCapacity} from "../../network/reqresp/requestCapacity.js";

export function getRequestCapacityToken(error: unknown): string | null {
  return error instanceof RequestError && error.type.code === RequestErrorCode.REQUEST_LOCAL_CAPACITY
    ? error.type.capacityToken
    : null;
}

/** One admission wait per scheduler; pending work stays in the scheduler's existing queues. */
export class RequestCapacityPause {
  private controller: AbortController | undefined;

  constructor(
    private readonly wait: WaitForRequestCapacity,
    private readonly resume: () => void,
    private readonly failed: (error: Error) => void
  ) {}

  get blocked(): boolean {
    return this.controller !== undefined;
  }

  pause(token: string): void {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    void this.run(token, controller);
  }

  private async run(token: string, controller: AbortController): Promise<void> {
    let retry = false;
    try {
      await this.wait(token, {signal: controller.signal, timeoutMs: 60000});
      retry = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.failed(error as Error);
        // A local waiting deadline permits one new admission attempt, without charging a download failure.
        retry = error instanceof TimeoutError;
      }
    }
    if (this.controller !== controller) return;
    this.controller = undefined;
    if (retry) this.resume();
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}
