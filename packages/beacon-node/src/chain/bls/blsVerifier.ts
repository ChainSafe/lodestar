import {type NativeHistogram, blsBatch} from "@chainsafe/lodestar-z/bls-batch";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {Logger} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {LinkedList} from "../../util/array.js";
import {IBlsVerifier, VerifySignatureOpts} from "./interface.js";

// --- Native set types (re-declared for local use in splitByType) ---

type IndexedNativeSet = {index: number; message: Uint8Array; signature: Uint8Array};
type AggregateNativeSet = {indices: number[]; message: Uint8Array; signature: Uint8Array};
type SingleNativeSet = {publicKey: Uint8Array; message: Uint8Array; signature: Uint8Array};

// --- Split helpers ---

type SplitResult = {
  indexed: IndexedNativeSet[];
  aggregate: AggregateNativeSet[];
  single: SingleNativeSet[];
};

/** Split ISignatureSet[] into typed buckets for separate native codepaths */
function splitByType(sets: ISignatureSet[]): SplitResult {
  const indexed: IndexedNativeSet[] = [];
  const aggregate: AggregateNativeSet[] = [];
  const single: SingleNativeSet[] = [];

  for (const set of sets) {
    switch (set.type) {
      case SignatureSetType.indexed:
        indexed.push({index: set.index, message: set.signingRoot, signature: set.signature});
        break;
      case SignatureSetType.aggregate:
        aggregate.push({indices: set.indices, message: set.signingRoot, signature: set.signature});
        break;
      case SignatureSetType.single:
        single.push({publicKey: set.pubkey.toBytes(), message: set.signingRoot, signature: set.signature});
        break;
    }
  }

  return {indexed, aggregate, single};
}

/** Number of pubkeys aggregated (aggregate-type sets only), matching unstable's metric. */
function getAggregatedPubkeysCount(sets: ISignatureSet[]): number {
  let count = 0;
  for (const set of sets) {
    if (set.type === SignatureSetType.aggregate) count += set.indices.length;
  }
  return count;
}

/**
 * Native `blsBatch` caps every job at this many sets and throws `TooManySets` for
 * anything larger; it does NOT chunk internally. A single `verifySignatureSets` call
 * can exceed this in one typed bucket — e.g. a maximally packed pre-electra block has
 * up to 128 attestation + attester-slashing `aggregate` sets — so the consumer must
 * split each bucket into chunks of this size and AND the results. Without this, a
 * valid block's signatures would be reported invalid. The value is the single source
 * of truth from the native module (`MAX_AGGREGATE_PER_JOB`).
 */
const MAX_SETS_PER_JOB = blsBatch.maxSetsPerJob;

/**
 * Native error `code`s that mean "the BLS subsystem could not run this job" rather
 * than "the signature is invalid": pool backpressure, shutdown, and misconfiguration.
 * These must NOT be conflated with a `false` verification result — for gossip that
 * would wrongly REJECT (and penalize the sending peer), and for block import it would
 * wrongly mark a valid block `INVALID_SIGNATURE`. Callers rethrow these so gossip maps
 * them to Ignore and block import treats them as transient. Genuine bad-input/crypto
 * errors (e.g. `DeserializationFailed`, `PointNotInGroup`) are NOT listed and keep the
 * `false`/REJECT behavior.
 */
const OPERATIONAL_ERROR_CODES = new Set([
  "PoolExhausted",
  "PoolNotInitialized",
  "PoolShuttingDown",
  "MultipleNapiEnvsUnsupported",
  "TooManySets",
  "InvalidSetKind",
  "InvalidMaxJobs",
  "PubkeyIndexNotInitialized",
  "InternalError",
]);

function isOperationalError(e: unknown): boolean {
  return e instanceof Error && OPERATIONAL_ERROR_CODES.has((e as {code?: string}).code ?? "");
}

type LabeledGauge = {set(labels: {le: string}, value: number): void};
type ScalarGauge = {set(value: number): void};

/**
 * Re-emit a native-bucketed histogram (from blsBatch.stats()) as prometheus
 * `_bucket{le}` / `_sum` / `_count` series. `counts` are already cumulative and the
 * total (`count`) is the implicit `+Inf` bucket, matching prometheus histogram layout.
 */
function emitNativeHistogram(h: NativeHistogram, bucket: LabeledGauge, sum: ScalarGauge, count: ScalarGauge): void {
  for (let i = 0; i < h.bounds.length; i++) {
    bucket.set({le: String(h.bounds[i])}, h.counts[i]);
  }
  bucket.set({le: "+Inf"}, h.count);
  sum.set(h.sum);
  count.set(h.count);
}

/**
 * Split `arr` into consecutive chunks of at most `size`. Returns `[]` for an empty
 * input (so callers can skip empty buckets) and the original array un-copied when it
 * already fits in one chunk (the common case).
 */
function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) {
    return arr.length === 0 ? [] : [arr];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// --- Batch accumulator constants ---

/**
 * If there are more than MAX_BATCH_SIGS buffered signatures, flush immediately.
 * 32 is a sweet spot: batching efficiency ~2x, risk of full-batch retry is bounded.
 */
const MAX_BATCH_SIGS = 32;

/**
 * Maximum time to wait before flushing buffered batchable sets.
 * Gossip objects arrive in bursts so a short delay improves batching.
 */
const BATCH_WAIT_MS = 100;

// --- Pending job types ---

type PendingJob = {
  sets: ISignatureSet[];
  resolve: (result: boolean) => void;
  reject: (error: Error) => void;
  enqueueTimeMs: number;
};

/**
 * BlsVerifier: thin JS layer over native N-API BLS verification.
 *
 * - `verifyOnMainThread` sets are verified synchronously on the calling thread.
 * - `batchable` sets are buffered and flushed together via async native methods.
 * - All other sets are submitted immediately via async native methods.
 * - Retry logic: on batch failure, each caller's sets are reverified individually.
 * - Backpressure is owned by native `blsBatch.canAcceptWork()` so Lodestar does
 *   not hide unlimited work behind JS Promises while the BLS worker pool is full.
 */
export class BlsVerifier implements IBlsVerifier {
  private readonly maxInflightJobs = 1000;
  private inflightJobs = 0;
  private closed = false;
  private readonly metrics: Metrics | null;
  private readonly logger: Logger;

  // Batch accumulator for batchable jobs
  private buffer: {
    jobs: LinkedList<PendingJob>;
    sigCount: number;
    timeout: NodeJS.Timeout;
  } | null = null;

  constructor(metrics: Metrics | null, logger: Logger) {
    this.metrics = metrics;
    this.logger = logger;
    blsBatch.init(this.maxInflightJobs);

    // Register the per-scrape sampler on the FIRST-registered blsVerifier metric so
    // that, during getMetrics(), this callback runs (populating every sampled gauge
    // below) before any of those gauges are read later in the same collection pass.
    metrics?.blsVerifier.totalSigSets.addCollect(() => {
      // A native binding failure here must NOT reject the whole /metrics scrape (which
      // would blank ALL lodestar metrics, not just BLS). Sample best-effort.
      try {
        metrics.blsVerifier.inflightJobs.set(this.inflightJobs);
        // Sample real native worker-pool occupancy once per scrape. These mirror the
        // old worker-thread pool's queue_length / workers_busy gauges so the two
        // implementations can be compared apples-to-apples.
        const s = blsBatch.stats();
        metrics.blsVerifier.queueLength.set(s.queued);
        metrics.blsVerifier.workersBusy.set(s.running);
        metrics.blsVerifier.workersTotal.set(s.workers);
        metrics.blsVerifier.activeJobs.set(s.active);
        metrics.blsVerifier.maxInflightJobs.set(s.maxInflight);
        metrics.blsVerifier.workerTimeSeconds.set(s.workerTimeSeconds);

        // Reconstruct the native-bucketed latency histograms into prometheus
        // `_bucket{le}`/`_sum`/`_count` series under the legacy histogram names.
        const m = metrics.blsVerifier;
        emitNativeHistogram(s.queueWait, m.queueJobWaitBucket, m.queueJobWaitSum, m.queueJobWaitCount);
        emitNativeHistogram(s.workerComputePerSigSet, m.workerComputeBucket, m.workerComputeSum, m.workerComputeCount);
        emitNativeHistogram(s.aggregateWithRandomness, m.aggRandBucket, m.aggRandSum, m.aggRandCount);
        emitNativeHistogram(s.pubkeysAggregation, m.pubkeysAggBucket, m.pubkeysAggSum, m.pubkeysAggCount);
      } catch (e) {
        this.logger.debug("Failed to sample blsBatch stats for metrics", {}, e as Error);
      }
    });
  }

  /** Count errored signature sets: the unlabeled legacy total + the native operational/input breakdown. */
  private countErroredSets(e: unknown, n: number): void {
    this.metrics?.blsVerifier.errorJobsSigSets.inc(n);
    this.metrics?.blsVerifier.errors.inc({type: isOperationalError(e) ? "operational" : "input"}, n);
  }

  async verifySignatureSets(sets: ISignatureSet[], opts: VerifySignatureOpts = {}): Promise<boolean> {
    if (sets.length === 0) {
      throw Error("Empty signature sets");
    }

    this.metrics?.blsVerifier.totalSigSets.inc(sets.length);
    // Pubkeys are aggregated on the main thread regardless of where verification runs.
    this.metrics?.blsVerifier.aggregatedPubkeys.inc(getAggregatedPubkeysCount(sets));
    if (opts.batchable) {
      this.metrics?.blsVerifier.batchableSigSets.inc(sets.length);
    }

    // Synchronous main-thread verification
    if (opts.verifyOnMainThread) {
      const timer = this.metrics?.blsVerifier.mainThreadDuration.startTimer();
      try {
        return this.verifySync(sets);
      } finally {
        timer?.();
      }
    }

    // Batchable: accumulate in buffer, flush on threshold or timeout
    if (opts.batchable) {
      return new Promise<boolean>((resolve, reject) => {
        this.enqueueBatchable({sets, resolve, reject, enqueueTimeMs: Date.now()});
      });
    }

    // Immediate async submission
    return this.verifyAsync(sets);
  }

  async verifySignatureSetsSameMessage(
    sets: {index: number; signature: Uint8Array}[],
    message: Uint8Array
  ): Promise<boolean[]> {
    if (sets.length === 0) {
      return [];
    }

    this.metrics?.blsVerifier.sameMessageSets.inc(sets.length);
    const timer = this.metrics?.blsVerifier.sameMessageDuration.startTimer();

    try {
      // Native caps each job at MAX_SETS_PER_JOB; verify each <=128 chunk as one
      // aggregate job. A chunk that fails falls back to per-signature verification
      // so failures stay isolated to that chunk instead of the whole set.
      return (
        await Promise.all(
          chunk(sets, MAX_SETS_PER_JOB).map((chunkSets) => this.verifySameMessageChunk(chunkSets, message))
        )
      ).flat();
    } finally {
      timer?.();
    }
  }

  /** Verify one <=MAX_SETS_PER_JOB same-message chunk, retrying its sets individually on failure */
  private async verifySameMessageChunk(
    sets: {index: number; signature: Uint8Array}[],
    message: Uint8Array
  ): Promise<boolean[]> {
    try {
      // Try aggregate verification first (1 native job). Started is counted only after
      // native admission (asyncVerifySameMessage sync-throws if not admitted).
      const isAllValid = await this.trackJob(() => {
        const p = blsBatch.asyncVerifySameMessage(
          sets.map((s) => ({index: s.index, signature: s.signature})),
          message
        );
        this.metrics?.blsVerifier.jobsStarted.inc({type: "sameMessage"}, 1);
        this.metrics?.blsVerifier.sigSetsStarted.inc({type: "sameMessage"}, sets.length);
        return p;
      });

      if (isAllValid) {
        this.metrics?.blsVerifier.successJobsSignatureSets.inc(sets.length);
        this.metrics?.blsVerifier.verifiedSigSets.inc(sets.length);
        return sets.map(() => true);
      }
    } catch (e) {
      // Don't retry our own operational failures (pool exhausted, shutdown, ...);
      // count + rethrow so the whole call rejects and gossip maps it to Ignore.
      if (isOperationalError(e)) {
        this.countErroredSets(e, sets.length);
        throw e;
      }
      // A verification/bad-input error: fall through to per-set retry to isolate it
      // (errored sets are counted per-set below, avoiding double-counting).
    }

    // Aggregate failed — retry each individually (1 native job per set). dispatchJob
    // does the per-set started/verified/errored accounting.
    this.metrics?.blsVerifier.sameMessageRetries.inc(sets.length);
    this.metrics?.blsVerifier.sameMessageRetryJobs.inc(1);
    return Promise.all(
      sets.map((set) =>
        this.dispatchJob(
          () => blsBatch.asyncVerify(blsBatch.indexed, [{index: set.index, message, signature: set.signature}]),
          "sameMessage",
          1
        ).catch((e) => {
          if (isOperationalError(e)) throw e;
          return false;
        })
      )
    );
  }

  async close(): Promise<void> {
    this.closed = true;

    if (this.buffer) {
      clearTimeout(this.buffer.timeout);
      // Reject all buffered jobs
      for (const job of this.buffer.jobs) {
        job.reject(Error("BlsVerifier closing"));
      }
      this.buffer = null;
    }
  }

  canAcceptWork(): boolean {
    return !this.closed && blsBatch.canAcceptWork();
  }

  // --- Internal ---

  /** Run one native async job. Native blsBatch owns admission and backpressure. */
  private async trackJob<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) {
      throw Error("BlsVerifier closing");
    }
    this.inflightJobs++;
    try {
      return await fn();
    } finally {
      this.inflightJobs--;
    }
  }

  /**
   * Dispatch one native pool job and account for it per-chunk:
   * - `started` counters fire only AFTER native admission succeeds — asyncVerify*
   *   throws SYNCHRONOUSLY (PoolExhausted/TooManySets) before returning a promise, so
   *   a rejected dispatch is never miscounted as "started".
   * - `verified` (true verdict) and `errored` sets are attributed to THIS chunk only,
   *   so a partial failure in a multi-chunk call doesn't smear the count across chunks.
   * Rejections are re-thrown so the caller's Promise.all still rejects.
   */
  private dispatchJob(submit: () => Promise<boolean>, type: "default" | "sameMessage", n: number): Promise<boolean> {
    return this.trackJob(() => {
      const p = submit(); // sync-throws on admission failure -> started not counted
      this.metrics?.blsVerifier.jobsStarted.inc({type}, 1);
      this.metrics?.blsVerifier.sigSetsStarted.inc({type}, n);
      return p;
    }).then(
      (ok) => {
        // Resolved (true or false) => the job completed without error.
        this.metrics?.blsVerifier.successJobsSignatureSets.inc(n);
        if (ok) this.metrics?.blsVerifier.verifiedSigSets.inc(n);
        return ok;
      },
      (e: unknown) => {
        this.countErroredSets(e, n); // only this chunk's sets errored
        throw e;
      }
    );
  }

  /** Synchronous verification on main thread via native sync methods */
  private verifySync(sets: ISignatureSet[]): boolean {
    try {
      const {indexed, aggregate, single} = splitByType(sets);

      // Each typed bucket is split into <=MAX_SETS_PER_JOB chunks; the native
      // layer rejects larger jobs. Short-circuit on the first failing chunk.
      for (const c of chunk(indexed, MAX_SETS_PER_JOB)) {
        if (!blsBatch.verify(blsBatch.indexed, c)) return false;
      }
      for (const c of chunk(aggregate, MAX_SETS_PER_JOB)) {
        if (!blsBatch.verify(blsBatch.aggregate, c)) return false;
      }
      for (const c of chunk(single, MAX_SETS_PER_JOB)) {
        if (!blsBatch.verify(blsBatch.single, c)) return false;
      }

      this.metrics?.blsVerifier.successJobsSignatureSets.inc(sets.length);
      this.metrics?.blsVerifier.verifiedSigSets.inc(sets.length);
      return true;
    } catch (e) {
      this.countErroredSets(e, sets.length);
      // Operational failures (pool exhausted, shutdown, ...) are not "invalid
      // signature" — rethrow so callers don't wrongly reject valid sets.
      if (isOperationalError(e)) throw e;
      this.logger.debug("verifySync caught error", {sets: sets.length}, e as Error);
      return false;
    }
  }

  /** Async verification via the dedicated native BLS worker pool */
  private async verifyAsync(sets: ISignatureSet[]): Promise<boolean> {
    const timer = this.metrics?.blsVerifier.asyncVerifyDuration.startTimer();
    try {
      const {indexed, aggregate, single} = splitByType(sets);

      // Each typed bucket is split into <=MAX_SETS_PER_JOB chunks, one native job
      // each (the native layer rejects larger jobs); all chunks must verify.
      // dispatchJob handles per-chunk started/verified/errored accounting.
      const promises: Promise<boolean>[] = [];
      for (const c of chunk(indexed, MAX_SETS_PER_JOB)) {
        promises.push(this.dispatchJob(() => blsBatch.asyncVerify(blsBatch.indexed, c), "default", c.length));
      }
      for (const c of chunk(aggregate, MAX_SETS_PER_JOB)) {
        promises.push(this.dispatchJob(() => blsBatch.asyncVerify(blsBatch.aggregate, c), "default", c.length));
      }
      for (const c of chunk(single, MAX_SETS_PER_JOB)) {
        promises.push(this.dispatchJob(() => blsBatch.asyncVerify(blsBatch.single, c), "default", c.length));
      }

      const results = await Promise.all(promises);
      return results.every((r) => r);
    } catch (e) {
      // Operational failures (pool exhausted, shutdown, ...) are not "invalid
      // signature" — rethrow so gossip maps to Ignore and block import retries.
      // (Per-chunk error counting already happened in dispatchJob.)
      if (isOperationalError(e)) throw e;
      this.logger.debug("verifyAsync caught error", {sets: sets.length}, e as Error);
      return false;
    } finally {
      const elapsed = timer?.();
      if (elapsed !== undefined && sets.length > 0) {
        this.metrics?.blsVerifier.timePerSigSet.observe(elapsed / sets.length);
      }
    }
  }

  /** Enqueue a batchable job into the buffer */
  private enqueueBatchable(job: PendingJob): void {
    if (!this.buffer) {
      this.buffer = {
        jobs: new LinkedList<PendingJob>(),
        sigCount: 0,
        timeout: setTimeout(() => this.flushBuffer(), BATCH_WAIT_MS),
      };
    }

    this.buffer.jobs.push(job);
    this.buffer.sigCount += job.sets.length;

    if (this.buffer.sigCount >= MAX_BATCH_SIGS) {
      clearTimeout(this.buffer.timeout);
      this.flushBuffer();
    }
  }

  /** Flush all buffered jobs: merge, verify as batch, retry individually on failure */
  private flushBuffer(): void {
    const buf = this.buffer;
    if (!buf) return;
    this.buffer = null;

    const allJobs = buf.jobs;
    if (allJobs.length === 0) return;

    this.metrics?.blsVerifier.batchedJobCount.inc(allJobs.length);

    // Merge all sets from all jobs into one batch
    const allSets: ISignatureSet[] = [];
    for (const job of allJobs) {
      for (const set of job.sets) {
        allSets.push(set);
      }
    }

    this.metrics?.blsVerifier.batchedSigCount.inc(allSets.length);

    // Observe buffer wait time for each job
    const flushTimeMs = Date.now();
    for (const job of allJobs) {
      this.metrics?.blsVerifier.bufferWaitTime.observe((flushTimeMs - job.enqueueTimeMs) / 1000);
    }

    // Fire-and-forget the async batch verification
    const flushTimer = this.metrics?.blsVerifier.batchFlushDuration.startTimer();
    this.verifyAsync(allSets).then(
      (batchValid) => {
        if (batchValid) {
          // Entire batch valid — resolve all
          flushTimer?.();
          this.metrics?.blsVerifier.batchSigsSuccess.inc(allSets.length);
          for (const job of allJobs) {
            job.resolve(true);
          }
        } else {
          // At least one set invalid — retry each job individually
          this.metrics?.blsVerifier.batchRetries.inc(1);
          const retryPromises: Promise<void>[] = [];
          for (const job of allJobs) {
            retryPromises.push(this.verifyAsync(job.sets).then(job.resolve, job.reject));
          }
          void Promise.all(retryPromises).finally(() => flushTimer?.());
        }
      },
      (error: Error) => {
        // Native operational failure (backpressure/shutdown/etc): do not retry
        // and add more work to the same saturated pool. Let gossip/import callers
        // handle it as transient.
        flushTimer?.();
        for (const job of allJobs) {
          job.reject(error);
        }
      }
    );
  }
}
