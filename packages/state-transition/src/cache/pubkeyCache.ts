import {PublicKey} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {phase0} from "@lodestar/types";

/**
 * Unified pubkey cache coupling index→pubkey and pubkey→index lookups.
 * Both directions are kept in sync atomically via `set()`.
 */
export interface PubkeyCache {
  /** Get deserialized PublicKey by validator index */
  get(index: number): PublicKey | undefined;
  /** Get validator index by pubkey bytes */
  getIndex(pubkey: Uint8Array): number | null;
  /** Set both directions atomically. Takes raw pubkey bytes — deserialization is handled internally. */
  set(index: number, pubkey: Uint8Array): void;
  /** Number of entries */
  readonly size: number;
}

class StandardPubkeyCache implements PubkeyCache {
  private readonly pubkey2index: PubkeyIndexMap;
  private readonly index2pubkey: (PublicKey | undefined)[];

  constructor(pubkey2index?: PubkeyIndexMap, index2pubkey?: (PublicKey | undefined)[]) {
    this.pubkey2index = pubkey2index ?? new PubkeyIndexMap();
    this.index2pubkey = index2pubkey ?? [];
  }

  get size(): number {
    return this.index2pubkey.length;
  }

  get(index: number): PublicKey | undefined {
    return this.index2pubkey[index];
  }

  getIndex(pubkey: Uint8Array): number | null {
    return this.pubkey2index.get(pubkey);
  }

  set(index: number, pubkey: Uint8Array): void {
    if (index !== this.index2pubkey.length) {
      throw Error(
        `PubkeyCache set() must be called with sequential indices. Expected index ${this.index2pubkey.length} but got ${index}`
      );
    }

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
 * Checks the pubkey indices against a state and adds missing pubkeys
 *
 * Mutates `pubkeyCache`
 *
 * If pubkey cache is empty: SLOW CODE - 🐢
 */
export function syncPubkeys(pubkeyCache: PubkeyCache, validators: phase0.Validator[]): void {
  const newCount = validators.length;
  for (let i = pubkeyCache.size; i < newCount; i++) {
    pubkeyCache.set(i, validators[i].pubkey);
  }
}
