/**
 * Aggregate pubkeys of the beacon committees of an epoch shuffling, held in native memory. Signature sets reference an
 * entry by id, so BLS worker threads can use it too.
 */

/** Entries the cache holds at most, counting computations in flight. */
export declare const COMMITTEE_PUBKEYS_MAX_ENTRIES: number;

/**
 * Aggregate the pubkeys of every committee of a shuffling on a libuv worker thread and resolve to the entry id.
 * `shuffling` is the shuffled active validator indices, and it is copied before this returns. Throws when
 * `COMMITTEE_PUBKEYS_MAX_ENTRIES` entries are cached or being computed.
 */
export declare function computeCommitteePubkeys(shuffling: Uint32Array, committeesPerSlot: number): Promise<number>;

/**
 * Free an entry. Returns false if `id` is unknown. A signature set that still references it falls back to its
 * participant indices.
 */
export declare function releaseCommitteePubkeys(id: number): boolean;

/** Number of cached entries. */
export declare function committeePubkeysCount(): number;
