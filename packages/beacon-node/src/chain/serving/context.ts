import {DB_READ_LIMITS_V1, DbReadLimits, DbReqOpts, FilterOptions} from "@lodestar/db";

export class ServingCapacityError extends Error {
  readonly code = "HOST_SERVING_CAPACITY";
  constructor(resource: string) {
    super(`Local serving capacity exhausted: ${resource}`);
  }
}

export class ServingConfigurationError extends Error {
  readonly code = "HOST_SERVING_CONFIGURATION";
}

export function isServingCapacityError(error: unknown): boolean {
  return (
    error instanceof ServingCapacityError ||
    (error instanceof Error &&
      "code" in error &&
      (error.code === "LEVEL_READ_LIMIT" || error.code === "LEVEL_ALLOCATION_FAILED"))
  );
}

export type ServingLimits = Readonly<{
  sourceBytes: number;
  decodedBytes: number;
  requestDecodedBytes: number;
  requestMetadata: number;
  requestScalars: number;
  ancestrySteps: number;
  transactionVisits: number;
  blockBytes: number;
  columnBytes: number;
  maxEntries: number;
  maxIteratorRows: number;
  lightClient: Readonly<{
    witness: number;
    committee: number;
    header: number;
    update: number;
    decodedBytes: number;
    metadata: number;
  }>;
}>;

/**
 * Retained sources survive yields; temporary source work stays charged until all reads settle. Every serving read
 * keeps the blocks it loads out of the LevelDB block cache. Stock reads rely on the stored value bounds of their
 * repositories; bounded reads use the patched DB's read limits.
 */
export class ServingContext {
  private operations = 0;
  private pendingSourceLimitBytes = 0;
  private cancelled = false;
  private peakBackingBytes = 0;
  private peakPendingSourceLimitBytes = 0;
  private backingOccurrences = 0;
  constructor(
    readonly limits: ServingLimits,
    private readonly onSettle: () => void = () => {}
  ) {}

  get pendingOperations(): number {
    return this.operations;
  }
  snapshot() {
    return {
      pendingOperations: this.operations,
      pendingSourceLimitBytes: this.pendingSourceLimitBytes,
      peakPendingSourceLimitBytes: this.peakPendingSourceLimitBytes,
      peakBackingBytes: this.peakBackingBytes,
      backingOccurrences: this.backingOccurrences,
    };
  }
  cancel(): void {
    this.cancelled = true;
  }
  assertActive(): void {
    if (this.cancelled) throw Object.assign(new Error("Serving cancelled"), {code: "HOST_SERVING_CANCELLED"});
  }
  /** Options of a stock range stream: one row per native read */
  streamOptions(): Pick<FilterOptions<never>, "fillCache" | "rowAtATime"> {
    this.assertActive();
    return {fillCache: false, rowAtATime: true};
  }
  /** Options of a bounded range stream */
  boundedStreamOptions(): DbReqOpts {
    return this.boundedReadOptions();
  }
  private checkSourcePhase(maxValueBytes: number, maxEntries: number): void {
    this.assertActive();
    if (
      !Number.isSafeInteger(maxValueBytes) ||
      maxValueBytes < 1 ||
      maxValueBytes > this.limits.sourceBytes ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      maxEntries > this.limits.maxEntries
    ) {
      throw new ServingCapacityError("source phase");
    }
  }
  private boundedReadOptions(maxValueBytes = this.limits.sourceBytes, maxEntries = 1): DbReqOpts {
    this.checkSourcePhase(maxValueBytes, maxEntries);
    const readLimits: DbReadLimits = {
      maxKeyBytes: DB_READ_LIMITS_V1.maxKeyBytes,
      maxValueBytes,
      maxTotalBytes: this.limits.sourceBytes,
      maxEntries,
    };
    return {fillCache: false, readLimits};
  }
  /** A stock read of a repository whose stored values are bounded; `maxValueBytes` and `maxEntries` size its charge */
  async read<T>(
    operation: (opts: DbReqOpts) => Promise<T>,
    maxValueBytes = this.limits.sourceBytes,
    maxEntries = 1
  ): Promise<T> {
    this.checkSourcePhase(maxValueBytes, maxEntries);
    return this.track(operation, {fillCache: false}, maxValueBytes, maxEntries);
  }
  /** A read limited by the patched DB, for repositories without a stored value bound */
  async boundedRead<T>(
    operation: (opts: DbReqOpts) => Promise<T>,
    maxValueBytes = this.limits.sourceBytes,
    maxEntries = 1
  ): Promise<T> {
    return this.track(operation, this.boundedReadOptions(maxValueBytes, maxEntries), maxValueBytes, maxEntries);
  }
  private async track<T>(
    operation: (opts: DbReqOpts) => Promise<T>,
    opts: DbReqOpts,
    maxValueBytes: number,
    maxEntries: number
  ): Promise<T> {
    const reservation = Math.min(this.limits.sourceBytes, maxValueBytes * maxEntries);
    if (this.operations >= 2 || this.pendingSourceLimitBytes + reservation > this.limits.sourceBytes) {
      throw new ServingCapacityError("concurrent source phase");
    }
    this.operations++;
    this.pendingSourceLimitBytes += reservation;
    this.peakPendingSourceLimitBytes = Math.max(this.peakPendingSourceLimitBytes, this.pendingSourceLimitBytes);
    try {
      return await operation(opts);
    } catch (error) {
      if (isServingCapacityError(error)) throw new ServingCapacityError("database read");
      throw error;
    } finally {
      this.operations--;
      this.pendingSourceLimitBytes -= reservation;
      this.onSettle();
    }
  }
  checkResponse(bytes: Uint8Array, maxBytes: number): Uint8Array {
    this.checkBatch([bytes], this.limits.sourceBytes, maxBytes);
    return bytes;
  }
  checkBacking(bytes: Uint8Array, maxBytes = this.limits.sourceBytes): Uint8Array {
    this.checkBatch([bytes], maxBytes);
    return bytes;
  }
  checkBatch(
    values: readonly (Uint8Array | undefined)[],
    maxBytes = this.limits.sourceBytes,
    maxValueBytes = this.limits.sourceBytes
  ): void {
    if (values.length > this.limits.maxEntries) throw new ServingCapacityError("batch entries");
    let total = 0;
    for (const value of values) {
      if (value && value.byteLength > maxValueBytes) throw new ServingCapacityError("response bytes");
      if (value) total += value.buffer.byteLength;
      if (!Number.isSafeInteger(total) || total > maxBytes) throw new ServingCapacityError("backing bytes");
    }
    this.backingOccurrences += values.length;
    this.peakBackingBytes = Math.max(this.peakBackingBytes, total);
  }
}

/** A stock serving read of a bounded repository, or the plain read outside serving */
export function servingRead<T>(
  context: ServingContext | undefined,
  operation: (opts?: DbReqOpts) => Promise<T>,
  maxValueBytes?: number,
  maxEntries?: number
): Promise<T> {
  return context ? context.read(operation, maxValueBytes, maxEntries) : operation();
}

/** A serving read limited by the patched DB, for block values, or the plain read outside serving */
export function servingBoundedRead<T>(
  context: ServingContext | undefined,
  operation: (opts?: DbReqOpts) => Promise<T>,
  maxValueBytes?: number,
  maxEntries?: number
): Promise<T> {
  return context ? context.boundedRead(operation, maxValueBytes, maxEntries) : operation();
}
