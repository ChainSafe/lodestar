import {PublicKey} from "@chainsafe/blst";
import {ValidatorIndex, phase0} from "@lodestar/types";

export type Index2PubkeyCache = PublicKey[];

type PubkeyHex = string;

/**
 * BLSPubkey is of type Bytes48, we can use a single buffer to compute hex for all pubkeys
 */
const pubkeyBuf = Buffer.alloc(48);

/**
 * toHexString() creates hex strings via string concatenation, which are very memory inefficient.
 * Memory benchmarks show that Buffer.toString("hex") produces strings with 10x less memory.
 *
 * Does not prefix to save memory, thus the prefix is removed from an already string representation.
 *
 * See https://github.com/ChainSafe/lodestar/issues/3446
 */
function toMemoryEfficientHexStr(hex: Uint8Array | string): string {
  if (typeof hex === "string") {
    if (hex.startsWith("0x")) {
      hex = hex.slice(2);
    }
    return hex;
  }

  pubkeyBuf.set(hex);
  return pubkeyBuf.toString("hex");
}

export class PubkeyIndexMap {
  // We don't really need the full pubkey. We could just use the first 20 bytes like an Ethereum address
  readonly map = new Map<PubkeyHex, ValidatorIndex>();

  get size(): number {
    return this.map.size;
  }

  /**
   * Must support reading with string for API support where pubkeys are already strings
   */
  get(key: Uint8Array | PubkeyHex): ValidatorIndex | undefined {
    return this.map.get(toMemoryEfficientHexStr(key));
  }

  set(key: Uint8Array, value: ValidatorIndex): void {
    this.map.set(toMemoryEfficientHexStr(key), value);
  }
}

/**
 * Checks the pubkey indices against a state and adds missing pubkeys
 *
 * Mutates `pubkey2index` and `index2pubkey`
 *
 * If pubkey caches are empty: SLOW CODE - 🐢
 */
export function syncPubkeys(
  validators: phase0.Validator[],
  pubkey2index: PubkeyIndexMap,
  index2pubkey: Index2PubkeyCache
): void {
  if (pubkey2index.size !== index2pubkey.length) {
    throw new Error(`Pubkey indices have fallen out of sync: ${pubkey2index.size} != ${index2pubkey.length}`);
  }

  const newCount = validators.length;
  index2pubkey.length = newCount;
  for (let i = pubkey2index.size; i < newCount; i++) {
    const pubkey = validators[i].pubkey;
    pubkey2index.set(pubkey, i);
    // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed.
    // Afterwards any public key is the state consider validated.
    // > Do not do any validation here
    index2pubkey[i] = PublicKey.fromBytes(pubkey); // Optimize for aggregation
  }
}
