import type {PublicKey} from "./blst.js";

/**
 * Append-only validator public-key cache.
 *
 * Throws when encountering:
 * - An existing index with a different public key.
 * - An existing public key at a different index.
 *
 * No-op for an exact index and public-key replay.
 */
export interface PubkeyCache {
  /** Get a cached, deserialized PublicKey. */
  get(index: number): PublicKey | undefined;
  /** Same as get(), but throws if the index is not in the cache */
  getOrThrow(index: number): PublicKey;
  /** Get the cached 48-byte compressed pubkey bytes without materializing a PublicKey wrapper. */
  getPubkeyBytes(index: number): Uint8Array | undefined;
  /** Same as getPubkeyBytes(), but throws if the index is not in the cache. */
  getPubkeyBytesOrThrow(index: number): Uint8Array;
  /** Aggregate cached public keys by validator index */
  aggregate(indices: number[]): PublicKey;
  /** Get validator index by pubkey bytes */
  getIndex(pubkey: Uint8Array): number | null;
  /**
   * Append a trusted public key at the next index. Before calling this method,
   * the caller must cryptographically validate the public key.
   *
   * The method throws if:
   *
   * - Encodings are malformed.
   * - Entries are sparse.
   */
  append(index: number, pubkey: Uint8Array): void;
  /**
   * Populate the cache from the missing suffix of a trusted validator list.
   * This method decodes public keys but does not validate.
   */
  syncPubkeys(validators: {pubkey: Uint8Array}[]): void;
  /** Current number of cached entries. */
  readonly size: number;
  /** Number of entries the current native allocation can hold without growing. */
  readonly capacity: number;
  /**
   * Load a compatible, trusted PKIX file from the control environment while no workers are using the cache.
   * Does not revalidate public keys. The explicit capacity
   * limit bounds both the entry count and native allocation; spare capacity
   * recorded in the file is discarded above this limit.
   */
  load(filepath: string, maxCapacity: number): void;
  /** Testing-only reset from the control environment while no workers are using the cache. */
  reset(): void;
  /** Save from the control environment. */
  save(filepath: string): void;
  /** Reserve exact native capacity when growing; existing larger capacity is retained. */
  ensureCapacity(capacity: number): void;
}

export declare const pubkeyCache: PubkeyCache;
