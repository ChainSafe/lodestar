import {DbReqOpts, FilterOptions} from "@lodestar/db";

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
  return error instanceof ServingCapacityError;
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
 * keeps the blocks it loads out of the LevelDB block cache and relies on the stored value bound of its repository.
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
  /** A read of a repository whose stored values are bounded; `maxValueBytes` and `maxEntries` size its charge */
  async read<T>(
    operation: (opts: DbReqOpts) => Promise<T>,
    maxValueBytes = this.limits.sourceBytes,
    maxEntries = 1
  ): Promise<T> {
    this.checkSourcePhase(maxValueBytes, maxEntries);
    return this.track(operation, {fillCache: false}, maxValueBytes, maxEntries);
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

/** A serving read of a bounded repository, or the plain read outside serving */
export function servingRead<T>(
  context: ServingContext | undefined,
  operation: (opts?: DbReqOpts) => Promise<T>,
  maxValueBytes?: number,
  maxEntries?: number
): Promise<T> {
  return context ? context.read(operation, maxValueBytes, maxEntries) : operation();
}

/**
 * Refuses serving a stored block that is not certified to fit MAX_PAYLOAD_SIZE, before any read of it; the peer sees a
 * resource-unavailable response. Reads outside serving are not refused.
 */
export function assertServableBlock(context: ServingContext | undefined, certified: boolean): void {
  if (context && !certified) throw new ServingCapacityError("uncertified block");
}
