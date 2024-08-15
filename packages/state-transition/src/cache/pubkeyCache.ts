import {PublicKey} from "@chainsafe/blst";
import {ValidatorIndex, phase0} from "@lodestar/types";

export type Index2PubkeyCache = PublicKey[];

type PubkeyHex = string;
type PubkeyBase64 = string;
const PUBKEY_BYTE_LENGTH = 48;
const PUBKEY_HEX_CHAR_LENGTH = 96;

/**
 * BLSPubkey is of type Bytes48, we can use a single buffer to compute hex for all pubkeys
 */
const pubkeyBuf = Buffer.alloc(PUBKEY_BYTE_LENGTH);

/**
 * toHexString() creates hex strings via string concatenation, which are very memory inefficient.
 * Memory benchmarks show that Buffer.toString("hex") produces strings with 10x less memory.
 *
 * Aug 2024: using base64 is 33% more memory efficient than hex
 *
 * See https://github.com/ChainSafe/lodestar/issues/3446
 */
function toMemoryEfficientString(pubkey: Uint8Array): PubkeyBase64 {
  if (pubkey.length === PUBKEY_BYTE_LENGTH) {
    pubkeyBuf.set(pubkey);
    return pubkeyBuf.toString("base64");
  } else {
    // only happens in unit tests
    return Buffer.from(pubkey.buffer, pubkey.byteOffset, pubkey.byteLength).toString("base64");
  }
}

export class PubkeyIndexMap {
  // TODO: We don't really need the full pubkey. We could just use the first 20 bytes like an Ethereum address
  readonly map = new Map<PubkeyBase64, ValidatorIndex>();

  get size(): number {
    return this.map.size;
  }

  /**
   * Must support reading with string for API support where pubkeys are already strings
   */
  get(key: Uint8Array | PubkeyHex): ValidatorIndex | undefined {
    if (typeof key === "string") {
      if (key.startsWith("0x")) {
        key = key.slice(2);
      }
      if (key.length === PUBKEY_HEX_CHAR_LENGTH) {
        // we don't receive api requests frequently, so the below conversion to Buffer then base64 should not be an issue
        pubkeyBuf.write(key, "hex");
        return this.map.get(toMemoryEfficientString(pubkeyBuf));
      } else {
        // base64 is only for internal use, don't support it
        return undefined;
      }
    }

    // Uint8Array
    return this.map.get(toMemoryEfficientString(key));
  }

  set(key: Uint8Array, value: ValidatorIndex): void {
    this.map.set(toMemoryEfficientString(key), value);
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
