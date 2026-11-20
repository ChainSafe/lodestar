import {ErrorAborted, LodestarError, TimeoutError, retry, sleep, withTimeout} from "@lodestar/utils";
import {PayloadSourceNotReady} from "./offerEligibility.js";
import {
  type BuildHandle,
  type BuildRequest,
  type BuiltPayload,
  type PayloadSource,
  type PayloadSourceResources,
  isAlternateBuild,
} from "./payloadSource.js";

const PREPARE_RETRY_DELAY = 100;
const PRIMARY_HANDOFF_TIMEOUT_MS = 25;

type UpdateOptions = {
  intervalMs: number;
  until: number;
  beforeRelease?: (handle: BuildHandle, signal: AbortSignal) => Promise<void>;
};

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
  LEASED_PAYLOAD_REQUIRES_UPDATES = "PAYLOAD_ORCHESTRATOR_ERROR_LEASED_PAYLOAD_REQUIRES_UPDATES",
  ALTERNATE_SOURCE_UNSUPPORTED = "PAYLOAD_ORCHESTRATOR_ERROR_ALTERNATE_SOURCE_UNSUPPORTED",
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
      code:
        | PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT
        | PayloadOrchestratorErrorCode.LEASED_PAYLOAD_REQUIRES_UPDATES
        | PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED;
      jobId: string;
    };

export class PayloadOrchestratorError extends LodestarError<PayloadOrchestratorErrorType> {}

/**
 * Prepares a payload and retrieves it at the requested time. Preparation is retried until the retrieval time,
 * the execution client may not have imported the parent payload yet.
 */
export class PayloadOrchestrator {
  private readonly jobs = new Map<string, Promise<BuiltPayload>>();
  private readonly updateJobs = new Map<string, Promise<void>>();
  private readonly snapshotJobs = new Map<string, Promise<void>>();

  constructor(
    private readonly source: PayloadSource,
    private readonly options: PayloadOrchestratorOptions,
    private readonly signal: AbortSignal
  ) {}

  get supportsUpdates(): boolean {
    return this.source.supportsUpdates === true;
  }

  get supportsBoundedAlternates(): boolean {
    return this.source.supportsBoundedAlternates === true;
  }

  get supportsRetainedOffers(): boolean {
    return (
      this.source.supportsRetainedOffers === true &&
      this.source.renewOffer !== undefined &&
      this.source.releaseOffer !== undefined
    );
  }

  get supportsPrimaryHandoff(): boolean {
    return (
      this.supportsRetainedOffers &&
      this.source.supportsPrimaryHandoff === true &&
      this.source.retainPrimaryPayload !== undefined
    );
  }

  async retainPrimaryPayload(handle: BuildHandle, payload: BuiltPayload, signal: AbortSignal): Promise<BuiltPayload> {
    if (!this.supportsPrimaryHandoff || !this.source.retainPrimaryPayload)
      throw new PayloadOrchestratorError({
        code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED,
        jobId: handle.payloadId,
      });
    return this.source.retainPrimaryPayload(handle, payload, signal);
  }

  async renewOffer(payload: BuiltPayload, signal: AbortSignal): Promise<boolean> {
    return (await this.source.renewOffer?.(payload, AbortSignal.any([this.signal, signal]))) ?? false;
  }

  async releaseOffer(payload: BuiltPayload): Promise<void> {
    // Cleanup is independent of a preempted build or stopped publisher.
    await this.source.releaseOffer?.(payload, AbortSignal.timeout(1000));
  }

  getResources(): PayloadSourceResources | undefined {
    return this.source.getResources?.();
  }

  async reconcileResources(signal: AbortSignal = this.signal): Promise<void> {
    await this.source.reconcileResources?.(AbortSignal.any([this.signal, signal]));
  }

  run(job: PayloadBuildJob, signal: AbortSignal = this.signal): Promise<BuiltPayload> {
    const {id} = job;
    let promise = this.jobs.get(id);
    if (promise === undefined) {
      promise = this.runJob(job, AbortSignal.any([this.signal, signal])).finally(() => this.jobs.delete(id));
      this.jobs.set(id, promise);
    }
    return promise;
  }

  /** Deliver one alternate. A true callback result explicitly owns its retained permission. */
  runSnapshot(
    job: PayloadBuildJob,
    onPayload: (payload: BuiltPayload) => Promise<boolean | void>,
    signal: AbortSignal = this.signal
  ): Promise<void> {
    let promise = this.snapshotJobs.get(job.id);
    if (promise === undefined) {
      promise = this.runSnapshotJob(job, onPayload, AbortSignal.any([this.signal, signal])).finally(() =>
        this.snapshotJobs.delete(job.id)
      );
      this.snapshotJobs.set(job.id, promise);
    }
    return promise;
  }

  private async runSnapshotJob(
    job: PayloadBuildJob,
    onPayload: (payload: BuiltPayload) => Promise<boolean | void>,
    signal: AbortSignal
  ): Promise<void> {
    if (
      !isAlternateBuild(job.request) ||
      (job.request.requireUnleased && job.request.requireRetainedOffer) ||
      !this.supportsBoundedAlternates ||
      (job.request.requireRetainedOffer && !this.supportsRetainedOffers)
    )
      throw new PayloadOrchestratorError({
        code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED,
        jobId: job.id,
      });
    const handle = await this.prepare(job, signal);
    let payload: BuiltPayload | undefined;
    let retained = false;
    try {
      await sleep(job.getPayloadAt - Date.now(), signal);
      payload = await this.retrieve(job.id, handle, signal);
      signal.throwIfAborted();
      if (
        payload.offerEligibility &&
        !(job.request.requireRetainedOffer && payload.offerEligibility.retained && this.supportsRetainedOffers)
      )
        throw new PayloadOrchestratorError({
          code: PayloadOrchestratorErrorCode.LEASED_PAYLOAD_REQUIRES_UPDATES,
          jobId: job.id,
        });
      if (job.request.requireRetainedOffer && !payload.offerEligibility?.retained)
        throw new PayloadOrchestratorError({
          code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED,
          jobId: job.id,
        });
      retained = (await onPayload(payload)) === true;
    } finally {
      // Permission cleanup must not delay physical worker release. Both remain
      // owned until settled; releaseOffer closes local eligibility synchronously.
      await Promise.all([
        payload?.offerEligibility?.retained && !retained ? this.releaseOffer(payload).catch(() => {}) : undefined,
        this.release(handle),
      ]);
    }
  }

  /** Poll ready snapshots until the cutoff. A callback completes before the next poll. */
  runUpdates(
    job: PayloadBuildJob,
    options: UpdateOptions,
    onPayload: (payload: BuiltPayload) => Promise<void>,
    signal: AbortSignal = this.signal
  ): Promise<void> {
    let promise = this.updateJobs.get(job.id);
    if (promise === undefined) {
      promise = this.runUpdateJob(job, options, onPayload, AbortSignal.any([this.signal, signal])).finally(() =>
        this.updateJobs.delete(job.id)
      );
      this.updateJobs.set(job.id, promise);
    }
    return promise;
  }

  private async runUpdateJob(
    job: PayloadBuildJob,
    {intervalMs, until, beforeRelease}: UpdateOptions,
    onPayload: (payload: BuiltPayload) => Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 25) throw new RangeError("Invalid payload update interval");
    const handle = await this.prepare({...job, getPayloadAt: until}, signal);
    let previous: BuiltPayload | undefined;
    try {
      while (Date.now() < until) {
        const started = Date.now();
        let payload: BuiltPayload;
        try {
          payload = await this.retrieve(
            job.id,
            handle,
            signal,
            Math.min(this.options.getPayloadTimeout, until - Date.now())
          );
        } catch (error) {
          if (error instanceof PayloadSourceNotReady && !signal.aborted) {
            await sleep(Math.min(intervalMs, Math.max(1, until - Date.now())), signal);
            continue;
          }
          // Ending the final poll at the cutoff does not invalidate a ready
          // revision. Earlier timeouts and jobs with no result remain errors.
          if (
            previous !== undefined &&
            !signal.aborted &&
            Date.now() >= until &&
            error instanceof PayloadOrchestratorError &&
            error.type.code === PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT
          )
            break;
          throw error;
        }
        signal.throwIfAborted();
        if (Date.now() >= until) break;
        // An unchanged leased candidate may become eligible again after a
        // slow durable write. Its heartbeat must retry selection/publication.
        if (payload !== previous || payload.offerEligibility !== undefined) {
          await onPayload(payload);
          previous = payload;
        }
        const now = Date.now();
        if (signal.aborted) throw new ErrorAborted();
        if (now >= until) break;
        // Retrieval and durable publication share one interval. A minimum
        // yield preserves cancellation and event-loop fairness on slow updates.
        await sleep(Math.min(Math.max(1, intervalMs - Math.max(0, now - started)), until - now), signal);
      }
    } finally {
      // A demotion may retain an exact permission before ending its worker.
      // It never waits on the cancelled build signal or a fresh primary job.
      if (beforeRelease && this.supportsPrimaryHandoff && !this.signal.aborted) {
        await withTimeout(
          (handoffSignal = AbortSignal.timeout(PRIMARY_HANDOFF_TIMEOUT_MS)) =>
            beforeRelease(handle, AbortSignal.any([this.signal, handoffSignal])),
          PRIMARY_HANDOFF_TIMEOUT_MS
        ).catch(() => {});
      }
      await this.release(handle);
    }
  }

  private async runJob(job: PayloadBuildJob, signal: AbortSignal): Promise<BuiltPayload> {
    const handle = await this.prepare(job, signal);
    try {
      await sleep(job.getPayloadAt - Date.now(), signal);
      const payload = await this.retrieve(job.id, handle, signal);
      if (payload.offerEligibility)
        throw new PayloadOrchestratorError(
          {code: PayloadOrchestratorErrorCode.LEASED_PAYLOAD_REQUIRES_UPDATES, jobId: job.id},
          "Order generation leases require continuous payload updates"
        );
      return payload;
    } finally {
      await this.release(handle);
    }
  }

  private async prepare({id, request, getPayloadAt}: PayloadBuildJob, signal: AbortSignal): Promise<BuildHandle> {
    if (isAlternateBuild(request) && !this.supportsBoundedAlternates)
      throw new PayloadOrchestratorError({code: PayloadOrchestratorErrorCode.ALTERNATE_SOURCE_UNSUPPORTED, jobId: id});
    const prepareTimeout = getPayloadAt - Date.now();
    if (!(prepareTimeout > 0)) {
      throw new PayloadOrchestratorError(
        {code: PayloadOrchestratorErrorCode.PREPARE_DEADLINE_REACHED, jobId: id, getPayloadAt},
        `Payload preparation deadline reached jobId=${id} getPayloadAt=${getPayloadAt}`
      );
    }

    let lastError: Error | null = null;
    return withTimeout(
      (prepareSignal = signal) =>
        retry(
          async () => {
            const handle = await this.source.prepare(request, prepareSignal);
            if (prepareSignal.aborted) {
              await this.release(handle);
              throw new ErrorAborted();
            }
            return handle;
          },
          {
            retries: isAlternateBuild(request) ? 0 : Infinity,
            retryDelay: PREPARE_RETRY_DELAY,
            onRetry: (error) => {
              lastError = error;
            },
            signal: prepareSignal,
          }
        ),
      prepareTimeout,
      signal
    ).catch((error: unknown) => {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError(
          {code: PayloadOrchestratorErrorCode.PREPARE_TIMEOUT, jobId: id, lastError: lastError?.message ?? null},
          `Payload preparation timed out jobId=${id} lastError=${lastError?.message}`
        );
      }
      throw error;
    });
  }

  private retrieve(
    id: string,
    handle: BuildHandle,
    signal: AbortSignal,
    timeout = this.options.getPayloadTimeout
  ): Promise<BuiltPayload> {
    return withTimeout(
      async (retrieveSignal = signal) => {
        const payload = await this.source.getPayload(handle, retrieveSignal);
        if (retrieveSignal.aborted) {
          // A source may complete after withTimeout detached the read. The
          // late grant has no callback owner, so release it exactly here.
          if (payload.offerEligibility?.retained) await this.releaseOffer(payload).catch(() => {});
          throw new ErrorAborted();
        }
        return payload;
      },
      timeout,
      signal
    ).catch((error: unknown) => {
      if (error instanceof TimeoutError) {
        throw new PayloadOrchestratorError({code: PayloadOrchestratorErrorCode.GET_PAYLOAD_TIMEOUT, jobId: id});
      }
      throw error;
    });
  }

  private async release(handle: BuildHandle): Promise<void> {
    // Cleanup must still run after the job's signal has been cancelled. Sources
    // also expire abandoned handles if transport fails during release.
    const release = this.source.release;
    if (!release) return;
    const timeout = this.supportsBoundedAlternates || this.source.getResources?.() !== undefined ? 6000 : 1000;
    await withTimeout(
      (signal = AbortSignal.timeout(timeout)) => release.call(this.source, handle, signal),
      timeout
    ).catch(() => {});
  }
}
