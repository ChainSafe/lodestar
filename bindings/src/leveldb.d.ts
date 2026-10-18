export type LevelDbOptions = {
  createIfMissing?: boolean;
  errorIfExists?: boolean;
  /** Share the engine and cache with other opted-in handles in this addon, including worker threads. Defaults to false. */
  multithreading?: boolean;
  /** Defaults to 8 MiB. Must be an integer from 1 byte through 256 MiB. */
  cacheBytes?: number;
  /** Defaults to 4 MiB. Must be an integer from 64 KiB through 64 MiB. */
  writeBufferBytes?: number;
  /** Defaults to 1000. Must be an integer from 74 through 4096. */
  maxOpenFiles?: number;
  /** Defaults to 4096. Must be an integer from 1 through 65536. */
  maxPendingOperations?: number;
  /** Queued native inputs and metadata. Defaults to 8 GiB, with a 16 GiB maximum. */
  maxPendingBytes?: number;
};

export type LevelDbReadOptions = {
  /** Populate the engine's block cache. Defaults to true for get and getMany. */
  fillCache?: boolean;
};

export type LevelDbWriteOptions = {
  /** Wait for the engine to synchronize the write before resolving. Defaults to false. */
  sync?: boolean;
};

export type LevelDbOperation = {type: "put"; key: Uint8Array; value: Uint8Array} | {type: "del"; key: Uint8Array};
export type LevelDbEntry = {key: Uint8Array; value: Uint8Array};

export type LevelDbScanOptions = {
  /** Exclusive lower bound. Ignored when gte is present. */
  gt?: Uint8Array;
  /** Inclusive lower bound. Takes precedence over gt. */
  gte?: Uint8Array;
  /** Exclusive upper bound. Ignored when lte is present. */
  lt?: Uint8Array;
  /** Inclusive upper bound. Takes precedence over lt. */
  lte?: Uint8Array;
  reverse?: boolean;
  /** Populate the engine's block cache. Defaults to false for iterators. */
  fillCache?: boolean;
  /** Maximum rows across all pages, from 0 through 2^32 - 1. Defaults to 2^32 - 1. */
  limit?: number;
};

export type LevelDbIteratorOptions = LevelDbScanOptions & {
  /** Include keys. Defaults to true. Disabled components are empty Uint8Arrays. */
  keys?: boolean;
  /** Include values. Defaults to true. Disabled components are empty Uint8Arrays. */
  values?: boolean;
};

export interface LevelDbIterator<T = LevelDbEntry> extends AsyncIterableIterator<T, undefined, undefined> {
  /** Only one next() or nextv() may be pending; concurrent pulls and seek during a pull reject with IteratorBusy. */
  next(): Promise<IteratorResult<T, undefined>>;
  /** Returns up to size rows, draining cached rows first. Sizes below 1 become 1; maximum 16,777,216. */
  nextv(size: number): Promise<T[]>;
  /**
   * Copies target; the next pull positions the original snapshot before reading. Out-of-range targets end iteration.
   * Preserves the snapshot and consumed row limit, including prefetched rows discarded by this seek.
   * Natural exhaustion can be reset; close cannot. Native positioning errors reject the next pull.
   */
  seek(target: Uint8Array): void;
  return(): Promise<IteratorResult<T, undefined>>;
  throw(error?: unknown): Promise<IteratorResult<T, undefined>>;
  close(): Promise<void>;
}

/**
 * Asynchronous LevelDB access with bounded native admission and copied inputs and outputs.
 * Each handle runs up to two get/getMany operations concurrently with its serialized writes, cursors and maintenance.
 * Await writes before issuing reads that must observe them. Read completions may arrive out of order.
 * Shared handles have independent queues and admission limits.
 * Keys are at most 4096 bytes, values at most 1 GiB, and atomic batch key/value totals at most 4 GiB.
 * Batches and getMany accept at most 16,777,216 entries. These are operating limits, not protocol maxima.
 * Admission rejects with PendingOperationsExceeded or PendingBytesExceeded instead of waiting for room.
 * Pending-byte admission counts copied inputs and job metadata. Read results are allocated to their actual size;
 * each active read or cursor page has a separate 1 GiB output bound.
 * Point reads temporarily materialize each complete stored value before checking that bound.
 * Up to two read results and one cursor/maintenance result can remain native-owned until JS delivery.
 * These bounds do not bound engine scratch memory, process RSS, or returned data retained by the caller.
 * Close iterators when abandoning them. Inputs must be attached Uint8Arrays backed by ordinary ArrayBuffers;
 * shared backing storage is rejected.
 * Errors use a stable string code; engine errors include their diagnostic detail in the message.
 */
export declare class LevelDb {
  private constructor();
  /**
   * Opens off the event loop. The path must contain 1 through 4096 UTF-8 bytes and no NUL characters.
   * With multithreading enabled, handles for the same resolved directory share the first opener's engine options.
   * Every handle must opt in. Closing one handle preserves other handles and their cursors.
   * The host must prevent concurrent access through other engine copies or filesystem aliases not resolved by realpath.
   */
  static open(path: string, options?: LevelDbOptions): Promise<LevelDb>;
  /** Removes an unopened database off the event loop. Rejects while this addon has an open handle. */
  static destroy(path: string): Promise<void>;
  get(key: Uint8Array, options?: LevelDbReadOptions): Promise<Uint8Array | null>;
  /** Reads one consistent snapshot, preserving key order and duplicates. Missing keys yield null; empty values yield empty arrays. */
  getMany(keys: readonly Uint8Array[], options?: LevelDbReadOptions): Promise<(Uint8Array | null)[]>;
  put(key: Uint8Array, value: Uint8Array, options?: LevelDbWriteOptions): Promise<void>;
  del(key: Uint8Array, options?: LevelDbWriteOptions): Promise<void>;
  /** Validates the entire batch before applying it atomically, in order. Never splits a batch into writes. */
  batch(operations: readonly LevelDbOperation[], options?: LevelDbWriteOptions): Promise<void>;
  /**
   * Takes a snapshot at this call's position among writes and cursor operations, before later writes.
   * Visits keys in byte order, descending when reverse is true. At most 64 cursors may be live per shared database.
   * The first next() and first next() after seek read one row; later refills read up to 1000.
   * Pages include the row crossing the fixed 16 KiB projected-byte watermark, within the 1 GiB output bound.
   * Manual next()/nextv() retain the snapshot after exhaustion so seek() can reuse it; close when finished.
   * for-await iteration, return(), close(), read errors and database close release it. Invalid options may throw synchronously.
   */
  iterator(options?: LevelDbIteratorOptions): LevelDbIterator;
  /** Iterates keys without copying or applying value-size limits to discarded values. */
  keys(options?: LevelDbScanOptions): LevelDbIterator<Uint8Array>;
  /** Iterates values without copying discarded keys or charging them against the page output bound. */
  values(options?: LevelDbScanOptions): LevelDbIterator<Uint8Array>;
  /** Deletes all records in bounded batches. Not atomic; existing snapshots retain their view. */
  clear(): Promise<void>;
  /** Estimates disk usage in [start, end). May exclude recently written data. */
  approximateSize(start: Uint8Array, end: Uint8Array): Promise<number>;
  /** Compacts the inclusive range [start, end] off the event loop. */
  compactRange(start: Uint8Array, end: Uint8Array): Promise<void>;
  /** Reads an engine diagnostic property, capped at 1 MiB. Unknown property names return null. */
  getProperty(name: string): Promise<string | null>;
  /** Rejects new work immediately, settles accepted work, and destroys all cursors. Repeated calls share a promise. */
  close(): Promise<void>;
}
