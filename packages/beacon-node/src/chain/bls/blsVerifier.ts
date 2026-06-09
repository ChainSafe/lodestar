import {blsBatch} from "@chainsafe/lodestar-z/bls-batch";
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

    metrics?.blsVerifier.inflightJobs.addCollect(() => {
      metrics.blsVerifier.inflightJobs.set(this.inflightJobs);
    });
  }

  async verifySignatureSets(sets: ISignatureSet[], opts: VerifySignatureOpts = {}): Promise<boolean> {
    if (sets.length === 0) {
      throw Error("Empty signature sets");
    }

    this.metrics?.blsVerifier.totalSigSets.inc(sets.length);
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
      // Try aggregate verification first (1 native job)
      const isAllValid = await this.trackJob(() =>
        blsBatch.asyncVerifySameMessage(
          sets.map((s) => ({index: s.index, signature: s.signature})),
          message
        )
      );

      if (isAllValid) {
        return sets.map(() => true);
      }
    } catch (e) {
      // Don't retry our own operational failures (pool exhausted, shutdown, ...);
      // rethrow so the whole call rejects and gossip maps it to Ignore.
      if (isOperationalError(e)) throw e;
      // A verification/bad-input error: fall through to per-set retry to isolate it.
    }

    // Aggregate failed — retry each individually (1 native job per set)
    this.metrics?.blsVerifier.sameMessageRetries.inc(sets.length);
    return Promise.all(
      sets.map(async (set) => {
        try {
          return await this.trackJob(() =>
            blsBatch.asyncVerify(blsBatch.indexed, [{index: set.index, message, signature: set.signature}])
          );
        } catch (e) {
          if (isOperationalError(e)) throw e;
          return false;
        }
      })
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

      return true;
    } catch (e) {
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
      const promises: Promise<boolean>[] = [];
      for (const c of chunk(indexed, MAX_SETS_PER_JOB)) {
        promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.indexed, c)));
      }
      for (const c of chunk(aggregate, MAX_SETS_PER_JOB)) {
        promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.aggregate, c)));
      }
      for (const c of chunk(single, MAX_SETS_PER_JOB)) {
        promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.single, c)));
      }

      const results = await Promise.all(promises);
      return results.every((r) => r);
    } catch (e) {
      // Operational failures (pool exhausted, shutdown, ...) are not "invalid
      // signature" — rethrow so gossip maps to Ignore and block import retries.
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
