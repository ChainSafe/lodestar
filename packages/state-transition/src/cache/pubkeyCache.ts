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
