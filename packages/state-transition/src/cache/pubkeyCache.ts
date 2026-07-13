import {PublicKey, aggregatePublicKeys} from "@chainsafe/blst";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ValidatorIndex} from "@lodestar/types";

/**
 * Original pubkey cache coupling index→pubkey and pubkey→index lookups.
 * Both directions are kept in sync atomically via `set()`.
 */
class StandardPubkeyCache {
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

  aggregate(indices: ValidatorIndex[]): PublicKey {
    return aggregatePublicKeys(indices.map((index) => this.getOrThrow(index)));
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

  reset(): void {
    this.pubkey2index.clear();
    this.index2pubkey.length = 0;
  }

  ensureCapacity(_capacity: number): void {
    // The JavaScript implementation grows dynamically.
  }
}

export function createStandardPubkeyCache(): StandardPubkeyCache {
  return new StandardPubkeyCache();
}
