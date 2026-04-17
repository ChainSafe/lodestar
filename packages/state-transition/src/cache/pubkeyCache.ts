import {PublicKey} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ValidatorIndex, phase0} from "@lodestar/types";

/**
 * Unified pubkey cache coupling index→pubkey and pubkey→index lookups.
 * Both directions are kept in sync atomically via `set()`.
 */
export interface PubkeyCache {
  /** Get deserialized PublicKey by validator index */
  get(index: ValidatorIndex): PublicKey | undefined;
  /** Get deserialized PublicKey by validator index or throw if not found */
  getOrThrow(index: ValidatorIndex): PublicKey;
  /** Get validator index by pubkey bytes */
  getIndex(pubkey: Uint8Array): ValidatorIndex | null;
  /** Set both directions atomically. Takes raw pubkey bytes — deserialization is handled internally. */
  set(index: ValidatorIndex, pubkey: Uint8Array): void;
  /** Number of entries */
  readonly size: number;
}

/**
 * Extended pubkey cache backed by the native lodestar-z singleton.
 * Adds persistence (load/save) and pre-allocation (ensureCapacity).
 */
export interface GlobalPubkeyCache extends PubkeyCache {
  /** Load pubkey cache state from a file */
  load(filepath: string): void;
  /** Save pubkey cache state to a file */
  save(filepath: string): void;
  /** Pre-allocate internal storage for `capacity` validators */
  ensureCapacity(capacity: number): void;
  /**
   * Bulk-append pubkeys. `pubkeys` is a flat `N*48` byte buffer containing
   * ONLY the new entries (appended starting at the current `size`).
   * Uncompresses in parallel above an internal threshold.
   */
  syncPubkeys(pubkeys: Uint8Array): void;
}

/**
 * Standard JS-side pubkey cache for use in tests and non-production contexts.
 * Wraps PubkeyIndexMap + PublicKey[] for bidirectional lookup.
 */
class StandardPubkeyCache implements PubkeyCache {
  private readonly pubkey2index: PubkeyIndexMap;
  private readonly index2pubkey: (PublicKey | undefined)[];

  constructor(pubkey2index?: PubkeyIndexMap, index2pubkey?: (PublicKey | undefined)[]) {
    this.pubkey2index = pubkey2index ?? new PubkeyIndexMap();
    this.index2pubkey = index2pubkey ?? [];
  }

  get size(): number {
    return this.pubkey2index.size;
  }

  get(index: ValidatorIndex): PublicKey | undefined {
    return this.index2pubkey[index];
  }

  getOrThrow(index: ValidatorIndex): PublicKey {
    const pubkey = this.get(index);
    if (!pubkey) throw Error(`Missing pubkey for validator index ${index}`);
    return pubkey;
  }

  getIndex(pubkey: Uint8Array): ValidatorIndex | null {
    return this.pubkey2index.get(pubkey);
  }

  set(index: ValidatorIndex, pubkey: Uint8Array): void {
    this.pubkey2index.set(pubkey, index);
    // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed.
    // Afterwards any public key in the state is considered validated.
    // > Do not do any validation here
    this.index2pubkey[index] = PublicKey.fromBytes(pubkey); // Optimize for aggregation
  }
}

export function createPubkeyCache(): PubkeyCache {
  return new StandardPubkeyCache();
}

/**
 * Checks the pubkey indices against a state and adds missing pubkeys.
 *
 * Mutates `pubkeyCache`.
 *
 * For the native `GlobalPubkeyCache`, new pubkeys are packed into a flat
 * `Uint8Array` and uncompressed in parallel on the Zig side. Other caches
 * (e.g. the JS test cache) fall through to the per-entry `set()` loop.
 */
export function syncPubkeys(pubkeyCache: PubkeyCache, validators: phase0.Validator[]): void {
  const oldSize = pubkeyCache.size;
  const newCount = validators.length;
  if (newCount <= oldSize) return;

  if (hasNativeSyncPubkeys(pubkeyCache)) {
    const addedCount = newCount - oldSize;
    const pubkeys = new Uint8Array(48 * addedCount);
    for (let i = 0; i < addedCount; i++) {
      pubkeys.set(validators[oldSize + i].pubkey, i * 48);
    }
    pubkeyCache.syncPubkeys(pubkeys);
    return;
  }

  for (let i = oldSize; i < newCount; i++) {
    pubkeyCache.set(i, validators[i].pubkey);
  }
}

function hasNativeSyncPubkeys(cache: PubkeyCache): cache is GlobalPubkeyCache {
  return typeof (cache as Partial<GlobalPubkeyCache>).syncPubkeys === "function";
}
