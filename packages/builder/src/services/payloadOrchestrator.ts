import {LodestarError, TimeoutError, retry, sleep, withTimeout} from "@lodestar/utils";
import {
  type BuildRequest,
  type BuiltPayload,
  type PayloadSource,
  PayloadSourceError,
  PayloadSourceErrorCode,
} from "./payloadSource.js";

const PREPARE_RETRY_DELAY = 100;

export type PayloadBuildJob = {
  /** Jobs with the same ID share one build and its result. */
  id: string;
  request: BuildRequest;
  /** Unix timestamp in milliseconds at which the prepared payload should be retrieved. */
  getPayloadAt: number;
};

export type PayloadOrchestratorOptions = {
  /** Maximum time in milliseconds to wait for payload retrieval. */
  getPayloadTimeout: number;
};

export enum PayloadOrchestratorErrorCode {
  PREPARE_DEADLINE_REACHED = "PAYLOAD_ORCHESTRATOR_ERROR_PREPARE_DEADLINE_REACHED",
  PREPARE_TIMEOUT = "PAYLOAD_ORCHESTRATOR_ERROR_PREPARE_TIMEOUT",
  GET_PAYLOAD_TIMEOUT = "PAYLOAD_ORCHESTRATOR_ERROR_GET_PAYLOAD_TIMEOUT",
}

export type PayloadOrchestratorErrorType =
  | {
      code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED;
      jobId: string;
      getPayloadAt: number;
    }
  | {
      code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT;
      jobId: string;
      lastError: string | null;
    }
  | {
      code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT;
      jobId: string;
    };

export class PayloadOrchestratorError extends LodestarError<PayloadOrchestratorErrorType> {}

/**
 * Prepares a payload and retrieves it at the requested time. Preparation retries missing payload IDs until the
 * retrieval time. Transport-level retries remain owned by the source.
 */
export class PayloadOrchestrator {
  private readonly jobs = new Map<string, Promise<BuiltPayload>>();

  constructor(
    private readonly source: PayloadSource,
    private readonly options: PayloadOrchestratorOptions,
    private readonly signal: AbortSignal
  ) {}

  run(job: PayloadBuildJob): Promise<BuiltPayload> {
    const {id} = job;
    let promise = this.jobs.get(id);
    if (promise === undefined) {
      promise = this.runJob(job).finally(() => this.jobs.delete(id));
      this.jobs.set(id, promise);
    }
    return promise;
  }

  private async runJob({id, request, getPayloadAt}: PayloadBuildJob): Promise<BuiltPayload> {
    const prepareTimeout = getPayloadAt - Date.now();
    if (!(prepareTimeout > 0)) {
      throw new PayloadOrchestratorError(
        {code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED, jobId: id, getPayloadAt},
        `Payload preparation deadline reached jobId=${id} getPayloadAt=${getPayloadAt}`
      );
    }

    let lastPrepareError: string | null = null;
    const handle = await withTimeout(
      (signal = this.signal) =>
        retry(() => this.source.prepare(request, signal), {
          retries: Infinity,
          retryDelay: PREPARE_RETRY_DELAY,
          shouldRetry: (error) => {
            lastPrepareError = error instanceof Error ? error.message : String(error);
            return error instanceof PayloadSourceError && error.type.code === PayloadSourceErrorCode.NO_PAYLOAD_ID;
          },
          signal,
        }),
      prepareTimeout,
      this.signal
    ).catch((error: unknown) => {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError({
          code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT,
          jobId: id,
          lastError: lastPrepareError,
        });
      }
      throw error;
    });

    await sleep(getPayloadAt - Date.now(), this.signal);

    return withTimeout(
      (signal = this.signal) => this.source.getPayload(handle, signal),
      this.options.getPayloadTimeout,
      this.signal
    ).catch((error: unknown) => {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError({code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: id});
      }
      throw error;
    });
  }
}
