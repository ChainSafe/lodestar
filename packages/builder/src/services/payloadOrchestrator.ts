import {LodestarError, TimeoutError, sleep, withTimeout} from "@lodestar/utils";
import type {BuildHandle, BuildRequest, BuiltPayload, PayloadSource} from "./payloadSource.js";

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

/**
 * Coordinates bounded payload preparation and retrieval without owning Engine connections or chain inputs.
 * Duplicate job IDs share one result. Aborting a job cancels its active source request. Each phase calls the
 * source once; request-level retries remain owned by that transport, and the orchestrator does not retry a failed job.
 */
export class PayloadOrchestrator {
  private readonly activeJobs = new Map<string, Promise<BuiltPayload>>();

  constructor(
    private readonly source: PayloadSource,
    private readonly options: PayloadOrchestratorOptions
  ) {
    this.assertOption("maxActiveJobs", options.maxActiveJobs);
    this.assertOption("getPayloadTimeout", options.getPayloadTimeout);
  }

  get activeJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Runs one build job. The first invocation for an active job ID owns its abort signal; duplicate
   * invocations share that job's promise and must therefore use the same Builder-lifetime signal.
   */
  run(job: PayloadBuildJob, signal: AbortSignal): Promise<BuiltPayload> {
    const existing = this.activeJobs.get(job.id);
    if (existing !== undefined) {
      return existing;
    }

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

    const promise = this.runJob(job, signal).finally(() => {
      if (this.activeJobs.get(job.id) === promise) {
        this.activeJobs.delete(job.id);
      }
    });

    this.activeJobs.set(job.id, promise);
    return promise;
  }

  private async runJob(job: PayloadBuildJob, signal: AbortSignal): Promise<BuiltPayload> {
    const prepareTimeout = job.getPayloadAt - Date.now();
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

    let prepareResult: {status: "success"; handle: BuildHandle} | {status: "error"; error: unknown};
    try {
      prepareResult = await withTimeout(
        async (requestSignal) => {
          try {
            return {
              status: "success",
              handle: await this.source.prepare(job.request, requestSignal ?? signal),
            } as const;
          } catch (error) {
            return {status: "error", error} as const;
          }
        },
        prepareTimeout,
        signal
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError(
          {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: job.id},
          `Payload preparation timed out jobId=${job.id}`
        );
      }
      throw error;
    }
    if (prepareResult.status === "error") {
      throw prepareResult.error;
    }
    const {handle} = prepareResult;

    const waitTime = job.getPayloadAt - Date.now();
    if (waitTime > 0) {
      await sleep(waitTime, signal);
    }

    let payloadResult: {status: "success"; payload: BuiltPayload} | {status: "error"; error: unknown};
    try {
      payloadResult = await withTimeout(
        async (requestSignal) => {
          try {
            return {status: "success", payload: await this.source.getPayload(handle, requestSignal ?? signal)} as const;
          } catch (error) {
            return {status: "error", error} as const;
          }
        },
        this.options.getPayloadTimeout,
        signal
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError(
          {code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: job.id},
          `Payload retrieval timed out jobId=${job.id}`
        );
      }
      throw error;
    }
    if (payloadResult.status === "error") {
      throw payloadResult.error;
    }
    return payloadResult.payload;
  }

  private assertOption(option: keyof PayloadOrchestratorOptions, value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new PayloadOrchestratorError(
        {code: PayloadOrchestratorErrorCode.INVALID_OPTION, option, value},
        `Invalid payload orchestrator option option=${option} value=${value}`
      );
    }
  }
}
