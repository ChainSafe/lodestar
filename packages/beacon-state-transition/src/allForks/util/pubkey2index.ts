import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ByteVector} from "@chainsafe/ssz";

type PubkeyHex = string;

/**
 * Running statistic analysis on mainnet pubkeys, using 4 bytes has a 1e-9 chance of collision.
 * Only the first byte has a predictable distribution, since it contains BLS flags.
 * However, memory benchmarks show that the savings of using only 4 bytes vs 8 bytes are 11%.
 * Thus we use BYTES_OFFSET_INITIAL = 0 for simplicity, and BYTES_PER_KEY = 8 such that the
 * chance of collision is extremely low. Aligning BYTES_OFFSET_INITIAL and BYTES_PER_KEY to cover
 * the full length of the pubkey ensures that the existing entry check in PubkeyIndexMap.set()
 * is 100% certain.
 */
const BYTES_OFFSET_INITIAL = 0;
const BYTES_PER_KEY = 8;
const BYTES_PER_BLS_PUBKEY = 48;

/**
 * Pubkey map with short keys to save memory. Each value may contain an index or a sub map if there are collisions.
 */
export class PubkeyIndexMap {
  // We don't really need the full pubkey. We could just use the first 20 bytes like an Ethereum address
  private readonly map = new Map<PubkeyHex, ValidatorIndex | PubkeyIndexMap>();
  /** Tracks size since this.map may contain recursive */
  private _size = 0;

  constructor(readonly bytesOffset: number = BYTES_OFFSET_INITIAL) {}

  get size(): number {
    return this._size;
  }

  /**
   * Must support reading with string for API support where pubkeys are already strings
   */
  get(pubkey: ByteVector | Uint8Array | PubkeyHex): ValidatorIndex | undefined {
    const indexOrMap = this.map.get(this.getKey(pubkey));
    if (indexOrMap === undefined || typeof indexOrMap === "number") {
      return indexOrMap;
    } else {
      return indexOrMap.get(pubkey);
    }
  }

  /**
   * To ensure pubkeys that have collisions can be re-map to a longer portion of their pubkey
   * @returns Returns true if a new entry was added
   */
  set(pubkey: ByteVector | Uint8Array, index: ValidatorIndex, state: allForks.BeaconState): void {
    const key = this.getKey(pubkey);

    const indexOrMap = this.map.get(key);

    // No entry, store index as number
    if (indexOrMap === undefined) {
      this.map.set(key, index);
    }

    // Collision, retrieve original pubkey and convert to sub map
    else if (typeof indexOrMap === "number") {
      // This check limites the max recusive depth of PubkeyIndexMap
      const bytesOffset = this.bytesOffset + BYTES_PER_KEY;
      if (bytesOffset > BYTES_PER_BLS_PUBKEY) {
        // This pubkey matches the existing record in BYTES_PER_BLS_PUBKEY - BYTES_OFFSET_INITIAL
        // it is considered to be the same.
        throw Error(`Attempting to set existing PubkeyIndexMap entry prevIndex: ${indexOrMap} index: ${index}`);
      }

      // Set map in current map
      const submap = new PubkeyIndexMap(bytesOffset);
      this.map.set(key, submap);

      // Add prev entry and new entry
      const prevPubkey = state.validators[indexOrMap].pubkey.valueOf() as Uint8Array;
      submap.set(prevPubkey, indexOrMap, state);
      submap.set(pubkey, index, state);
    }

    // Already existing submap, forward call
    else {
      indexOrMap.set(pubkey, index, state);
    }

    // PubkeyIndexMap does not allow to set duplicate entries.
    // To reach this line all recursive calls to .set() must have succeeded, safe to increase a counter.
    this._size++;
  }

  /**
   * toHexString() creates hex strings via string concatenation, which are very memory inneficient.
   * Memory benchmarks show that Buffer.toString("hex") produces strings with 10x less memory.
   *
   * Does not prefix to save memory, thus the prefix is removed from an already string representation.
   * Encoding in base64, base64url or hex results in the same memory footprint. Thus encode in hex for simplicity.
   *
   * See https://github.com/ChainSafe/lodestar/issues/3446
   */
  private getKey(pubkey: ByteVector | Uint8Array | PubkeyHex): string {
    if (typeof pubkey === "string") {
      if (pubkey.startsWith("0x")) {
        pubkey = pubkey.slice(2);
      }

      return pubkey.slice(this.bytesOffset * 2, (this.bytesOffset + BYTES_PER_KEY) * 2);
    }

    return Buffer.from(pubkey as Uint8Array)
      .slice(this.bytesOffset, this.bytesOffset + BYTES_PER_KEY)
      .toString("hex");
  }
}
