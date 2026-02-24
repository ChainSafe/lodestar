import {blsBatch} from "@chainsafe/lodestar-z/bls-batch";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
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
 * - Backpressure via `canAcceptWork()` using `inflightJobs` counter against `maxInflightJobs`.
 */
export class BlsVerifier implements IBlsVerifier {
  private maxInflightJobs = 40_000;
  private inflightJobs = 0;
  private jobWaiters = new LinkedList<() => void>();
  private closed = false;
  private readonly metrics: Metrics | null;

  // Batch accumulator for batchable jobs
  private buffer: {
    jobs: LinkedList<PendingJob>;
    prioritizedJobs: LinkedList<PendingJob>;
    sigCount: number;
    timeout: NodeJS.Timeout;
  } | null = null;

  constructor(metrics: Metrics | null) {
    this.metrics = metrics;
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
        this.enqueueBatchable({sets, resolve, reject, enqueueTimeMs: Date.now()}, opts.priority ?? false);
      });
    }

    // Immediate async submission
    return this.verifyAsync(sets);
  }

  async verifySignatureSetsSameMessage(
    sets: {index: number; signature: Uint8Array}[],
    message: Uint8Array,
    _opts?: Omit<VerifySignatureOpts, "verifyOnMainThread">
  ): Promise<boolean[]> {
    if (sets.length === 0) {
      return [];
    }

    this.metrics?.blsVerifier.sameMessageSets.inc(sets.length);
    const timer = this.metrics?.blsVerifier.sameMessageDuration.startTimer();

    try {
      // Try aggregate verification first (1 native job)
      const isAllValid = await this.trackJob(() =>
        blsBatch.asyncVerifySameMessage(
          sets.map((s) => ({index: s.index, signature: s.signature})),
          message
        )
      );

      if (isAllValid) {
        timer?.();
        return sets.map(() => true);
      }
    } catch {
      // Fall through to individual retry
    }

    // Aggregate failed — retry each individually (1 native job per set)
    this.metrics?.blsVerifier.sameMessageRetries.inc(sets.length);
    const results = await Promise.all(
      sets.map(async (set) => {
        try {
          return await this.trackJob(() =>
            blsBatch.asyncVerify(blsBatch.indexed, [{index: set.index, message, signature: set.signature}])
          );
        } catch {
          return false;
        }
      })
    );

    timer?.();
    return results;
  }

  async close(): Promise<void> {
    this.closed = true;

    if (this.buffer) {
      clearTimeout(this.buffer.timeout);
      // Reject all buffered jobs
      for (const job of this.buffer.prioritizedJobs) {
        job.reject(Error("BlsVerifier closing"));
      }
      for (const job of this.buffer.jobs) {
        job.reject(Error("BlsVerifier closing"));
      }
      this.buffer = null;
    }

    // Unblock any jobs waiting for a slot so callers don't hang.
    // They will see closed=true and throw without dispatching work.
    for (const resolve of this.jobWaiters) {
      resolve();
    }
    this.jobWaiters = new LinkedList<() => void>();
  }

  canAcceptWork(): boolean {
    return this.inflightJobs < this.maxInflightJobs;
  }

  // --- Internal ---

  /** Run a native async job, waiting for a slot if at capacity */
  private async trackJob<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inflightJobs >= this.maxInflightJobs) {
      // Wait for a slot — when woken, the releasing job transfers its slot to us
      await new Promise<void>((resolve) => {
        this.jobWaiters.push(resolve);
      });
      if (this.closed) {
        throw Error("BlsVerifier closing");
      }
    } else {
      this.inflightJobs++;
    }
    try {
      return await fn();
    } finally {
      if (this.jobWaiters.length > 0) {
        // Transfer slot directly to next waiter
        // biome-ignore lint/style/noNonNullAssertion: length check above
        this.jobWaiters.shift()!();
      } else {
        this.inflightJobs--;
      }
    }
  }

  /** Synchronous verification on main thread via native sync methods */
  private verifySync(sets: ISignatureSet[]): boolean {
    try {
      const {indexed, aggregate, single} = splitByType(sets);

      if (indexed.length > 0 && !blsBatch.verify(blsBatch.indexed, indexed)) return false;
      if (aggregate.length > 0 && !blsBatch.verify(blsBatch.aggregate, aggregate)) return false;
      if (single.length > 0 && !blsBatch.verify(blsBatch.single, single)) return false;

      return true;
    } catch {
      // A signature could be malformed, causing a deserialization error
      return false;
    }
  }

  /** Async verification via native async methods (libuv threadpool) */
  private async verifyAsync(sets: ISignatureSet[]): Promise<boolean> {
    const timer = this.metrics?.blsVerifier.asyncVerifyDuration.startTimer();
    try {
      const {indexed, aggregate, single} = splitByType(sets);

      const promises: Promise<boolean>[] = [];
      if (indexed.length > 0) promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.indexed, indexed)));
      if (aggregate.length > 0) promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.aggregate, aggregate)));
      if (single.length > 0) promises.push(this.trackJob(() => blsBatch.asyncVerify(blsBatch.single, single)));

      const results = await Promise.all(promises);
      return results.every((r) => r);
    } catch {
      // A signature could be malformed, causing a deserialization error
      return false;
    } finally {
      const elapsed = timer?.();
      if (elapsed !== undefined && sets.length > 0) {
        this.metrics?.blsVerifier.timePerSigSet.observe(elapsed / sets.length);
      }
    }
  }

  /** Enqueue a batchable job into the buffer */
  private enqueueBatchable(job: PendingJob, priority: boolean): void {
    if (!this.buffer) {
      this.buffer = {
        jobs: new LinkedList<PendingJob>(),
        prioritizedJobs: new LinkedList<PendingJob>(),
        sigCount: 0,
        timeout: setTimeout(() => this.flushBuffer(), BATCH_WAIT_MS),
      };
    }

    if (priority) {
      this.buffer.prioritizedJobs.push(job);
    } else {
      this.buffer.jobs.push(job);
    }
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

    // Prioritized jobs go first
    const allJobs = new LinkedList<PendingJob>();
    for (const job of buf.prioritizedJobs) allJobs.push(job);
    for (const job of buf.jobs) allJobs.push(job);
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
        // Total failure — retry each job individually
        const retryPromises: Promise<void>[] = [];
        for (const job of allJobs) {
          retryPromises.push(this.verifyAsync(job.sets).then(job.resolve, () => job.reject(error)));
        }
        void Promise.all(retryPromises).finally(() => flushTimer?.());
      }
    );
  }
}
