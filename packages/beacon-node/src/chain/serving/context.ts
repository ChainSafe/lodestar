import {BUCKET_LENGTH, DbReqOpts, FilterOptions, uintLen} from "@lodestar/db";
import {DataColumnStoreError, DataColumnStoreErrorCode} from "../../db/flatFileStore/errors.js";

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
    (error instanceof DataColumnStoreError && error.type.code === DataColumnStoreErrorCode.READ_LIMIT_EXCEEDED) ||
    (error instanceof Error && "code" in error && (error.code === "ValueTooLarge" || error.code === "BatchTooLarge"))
  );
}

export type ServingLimits = Readonly<{
  sourceBytes: number;
  decodedBytes: number;
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
  }>;
}>;

/**
 * Retained sources survive yields; temporary source work stays charged until all reads settle. Production reads
 * bound output before allocation or decompression; LevelDB reads also bypass its block cache. Legacy column
 * fallback reads do not enforce these limits.
 */
export class ServingContext {
  private operations = 0;
  private pendingSourceLimitBytes = 0;
  private cancelled = false;
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
    };
  }
  cancel(): void {
    this.cancelled = true;
  }
  assertActive(): void {
    if (this.cancelled) throw Object.assign(new Error("Serving cancelled"), {code: "HOST_SERVING_CANCELLED"});
  }
  /** Slot-keyed range stream: one bounded value plus its encoded slot key per native read. */
  streamOptions(
    maxValueBytes = this.limits.sourceBytes
  ): Pick<FilterOptions<never>, "fillCache" | "rowAtATime" | "maxValueBytes" | "maxTotalBytes"> {
    maxValueBytes = Math.min(maxValueBytes, this.limits.sourceBytes);
    this.checkSourcePhase(maxValueBytes, 1);
    return {
      fillCache: false,
      rowAtATime: true,
      maxValueBytes,
      maxTotalBytes: maxValueBytes + BUCKET_LENGTH + uintLen,
    };
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
  /** Native output and its reservation are bounded until the read settles. */
  async read<T>(
    operation: (opts: DbReqOpts) => Promise<T>,
    maxValueBytes = this.limits.sourceBytes,
    maxEntries = 1
  ): Promise<T> {
    this.checkSourcePhase(maxValueBytes, maxEntries);
    try {
      return await this.track(
        operation,
        {fillCache: false, maxValueBytes, maxTotalBytes: Math.min(this.limits.sourceBytes, maxValueBytes * maxEntries)},
        maxValueBytes,
        maxEntries
      );
    } catch (error) {
      if (!(error instanceof ServingCapacityError) && isServingCapacityError(error))
        throw new ServingCapacityError("source bytes");
      throw error;
    }
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
