import {sszTypesFor} from "@lodestar/types";
import {LodestarError, TimeoutError, retry, sleep, withTimeout} from "@lodestar/utils";
import {
  type BuildRequest,
  type BuiltPayload,
  type PayloadSource,
  PayloadSourceError,
  PayloadSourceErrorCode,
} from "./payloadSource.js";

// Node clamps larger timer delays to 1 ms.
const MAX_TIMER_DELAY = 2 ** 31 - 1;
const PREPARE_RETRY_DELAY = 100;

export type PayloadBuildJob = {
  /** Stable identity for all build inputs. Jobs with the same ID share one lifecycle and result. */
  id: string;
  request: BuildRequest;
  /** Unix timestamp in milliseconds at which the prepared payload should be retrieved. */
  getPayloadAt: number;
};

export type PayloadOrchestratorOptions = {
  /** Maximum number of distinct jobs that may be active at once. */
  maxActiveJobs: number;
  /** Maximum time in milliseconds to wait for payload retrieval. */
  getPayloadTimeout: number;
};

export enum PayloadOrchestratorErrorCode {
  INVALID_OPTION = "PAYLOAD_ORCHESTRATOR_ERROR_INVALID_OPTION",
  INVALID_GET_PAYLOAD_AT = "PAYLOAD_ORCHESTRATOR_ERROR_INVALID_GET_PAYLOAD_AT",
  JOB_ID_CONFLICT = "PAYLOAD_ORCHESTRATOR_ERROR_JOB_ID_CONFLICT",
  ACTIVE_JOB_LIMIT = "PAYLOAD_ORCHESTRATOR_ERROR_ACTIVE_JOB_LIMIT",
  PREPARE_DEADLINE_REACHED = "PAYLOAD_ORCHESTRATOR_ERROR_PREPARE_DEADLINE_REACHED",
  PREPARE_TIMEOUT = "PAYLOAD_ORCHESTRATOR_ERROR_PREPARE_TIMEOUT",
  GET_PAYLOAD_TIMEOUT = "PAYLOAD_ORCHESTRATOR_ERROR_GET_PAYLOAD_TIMEOUT",
}

export type PayloadOrchestratorErrorType =
  | {
      code: PayloadOrchestratorErrorCode.INVALID_OPTION;
      option: keyof PayloadOrchestratorOptions;
      value: number;
    }
  | {
      code: PayloadOrchestratorErrorCode.ACTIVE_JOB_LIMIT;
      jobId: string;
      maxActiveJobs: number;
    }
  | {
      code: PayloadOrchestratorErrorCode.JOB_ID_CONFLICT;
      jobId: string;
    }
  | {
      code: PayloadOrchestratorErrorCode.INVALID_GET_PAYLOAD_AT;
      jobId: string;
      getPayloadAt: number;
    }
  | {
      code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED;
      jobId: string;
      getPayloadAt: number;
    }
  | {
      code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT | PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT;
      jobId: string;
    };

export class PayloadOrchestratorError extends LodestarError<PayloadOrchestratorErrorType> {}

type ActivePayloadBuildJob = {
  key: string;
  promise: Promise<BuiltPayload>;
};

/**
 * Coordinates bounded payload preparation and retrieval without owning Engine connections or chain inputs.
 * Duplicate job IDs share one result. Aborting a job cancels its active source request. Preparation retries
 * missing payload IDs until the retrieval deadline; transport-level retries remain owned by the source.
 */
export class PayloadOrchestrator {
  private readonly activeJobs = new Map<string, ActivePayloadBuildJob>();

  constructor(
    private readonly source: PayloadSource,
    private readonly options: PayloadOrchestratorOptions
  ) {
    this.assertOption("maxActiveJobs", options.maxActiveJobs, Number.MAX_SAFE_INTEGER);
    this.assertOption("getPayloadTimeout", options.getPayloadTimeout, MAX_TIMER_DELAY);
  }

  get activeJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Runs one build job. The first invocation for an active job ID owns its abort signal; duplicate
   * invocations share that job's promise and must therefore use the same Builder-lifetime signal.
   * Request contents must remain unchanged until the job settles.
   */
  run(job: PayloadBuildJob, signal: AbortSignal): Promise<BuiltPayload> {
    if (!Number.isSafeInteger(job.getPayloadAt)) {
      return Promise.reject(
        new PayloadOrchestratorError(
          {
            code: PayloadOrchestratorErrorCode.INVALID_GET_PAYLOAD_AT,
            jobId: job.id,
            getPayloadAt: job.getPayloadAt,
          },
          `Invalid payload retrieval time jobId=${job.id} getPayloadAt=${job.getPayloadAt}`
        )
      );
    }

    const key = getPayloadBuildJobKey(job);
    const existing = this.activeJobs.get(job.id);
    if (existing !== undefined) {
      if (existing.key !== key) {
        return Promise.reject(
          new PayloadOrchestratorError(
            {code: PayloadOrchestratorErrorCode.JOB_ID_CONFLICT, jobId: job.id},
            `Payload build job ID reused with different inputs jobId=${job.id}`
          )
        );
      }

      return existing.promise;
    }

    if (this.activeJobs.size >= this.options.maxActiveJobs) {
      return Promise.reject(
        new PayloadOrchestratorError(
          {
            code: PayloadOrchestratorErrorCode.ACTIVE_JOB_LIMIT,
            jobId: job.id,
            maxActiveJobs: this.options.maxActiveJobs,
          },
          `Payload build job limit reached jobId=${job.id} maxActiveJobs=${this.options.maxActiveJobs}`
        )
      );
    }

    const {id} = job;
    const promise = this.runJob({...job}, signal).finally(() => {
      if (this.activeJobs.get(id)?.promise === promise) {
        this.activeJobs.delete(id);
      }
    });

    this.activeJobs.set(id, {key, promise});
    return promise;
  }

  private async runJob(job: PayloadBuildJob, signal: AbortSignal): Promise<BuiltPayload> {
    const prepareTimeout = job.getPayloadAt - Date.now();
    if (prepareTimeout > MAX_TIMER_DELAY) {
      throw new PayloadOrchestratorError({
        code: PayloadOrchestratorErrorCode.INVALID_GET_PAYLOAD_AT,
        jobId: job.id,
        getPayloadAt: job.getPayloadAt,
      });
    }
    if (prepareTimeout <= 0) {
      throw new PayloadOrchestratorError(
        {
          code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED,
          jobId: job.id,
          getPayloadAt: job.getPayloadAt,
        },
        `Payload preparation deadline reached jobId=${job.id} getPayloadAt=${job.getPayloadAt}`
      );
    }

    const handle = await withBuildTimeout(
      (requestSignal) =>
        retry(() => this.source.prepare(job.request, requestSignal), {
          retries: Infinity,
          retryDelay: PREPARE_RETRY_DELAY,
          shouldRetry: (error) =>
            error instanceof PayloadSourceError && error.type.code === PayloadSourceErrorCode.NO_PAYLOAD_ID,
          signal: requestSignal,
        }),
      prepareTimeout,
      signal,
      {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: job.id}
    );

    for (let waitTime = job.getPayloadAt - Date.now(); waitTime > 0; waitTime = job.getPayloadAt - Date.now()) {
      await sleep(Math.min(waitTime, MAX_TIMER_DELAY), signal);
    }

    return withBuildTimeout(
      (requestSignal) => this.source.getPayload(handle, requestSignal),
      this.options.getPayloadTimeout,
      signal,
      {code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: job.id}
    );
  }

  private assertOption(option: keyof PayloadOrchestratorOptions, value: number, max: number): void {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new PayloadOrchestratorError(
        {code: PayloadOrchestratorErrorCode.INVALID_OPTION, option, value},
        `Invalid payload orchestrator option option=${option} value=${value}`
      );
    }
  }
}

function getPayloadBuildJobKey(job: PayloadBuildJob): string {
  const {request} = job;
  const {headBlockHash, safeBlockHash, finalizedBlockHash} = request.forkchoiceState;
  return JSON.stringify({
    getPayloadAt: job.getPayloadAt,
    fork: request.fork,
    headBlockHash,
    safeBlockHash,
    finalizedBlockHash,
    payloadAttributes: sszTypesFor(request.fork, "PayloadAttributes").toJson(request.payloadAttributes),
  });
}

async function withBuildTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeout: number,
  signal: AbortSignal,
  errorType: {
    code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT | PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT;
    jobId: string;
  }
): Promise<T> {
  // Keep source errors, including TimeoutError, distinct from the orchestration deadline.
  const result = await withTimeout(
    async (requestSignal) => {
      try {
        return {ok: true, value: await fn(requestSignal ?? signal)} as const;
      } catch (error) {
        return {ok: false, error} as const;
      }
    },
    timeout,
    signal
  ).catch((error: unknown) => {
    if (error instanceof TimeoutError) throw new PayloadOrchestratorError(errorType);
    throw error;
  });
  if (!result.ok) throw result.error;
  return result.value;
}
