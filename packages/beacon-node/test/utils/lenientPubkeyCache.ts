import {PublicKey, aggregatePublicKeys} from "@chainsafe/lodestar-z/blst";
import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {toHex} from "@lodestar/utils";

/**
 * A `PubkeyCache` for test fixtures whose validators may carry placeholder pubkeys that are not valid BLS
 * points (the EIP-8453 compliance suite's single-validator states use zero or counter bytes). Keys are stored
 * and looked up as bytes, and only decoded when a signature check actually needs them.
 */
export class LenientPubkeyCache implements PubkeyCache {
  private readonly bytes: Uint8Array[] = [];
  private readonly indexByHex = new Map<string, number>();
  private readonly decoded = new Map<number, PublicKey>();

  get size(): number {
    return this.bytes.length;
  }

  get capacity(): number {
    return this.bytes.length;
  }

  get(index: number): PublicKey | undefined {
    if (index >= this.bytes.length) return undefined;
    let pubkey = this.decoded.get(index);
    if (pubkey === undefined) {
      pubkey = PublicKey.fromBytes(this.bytes[index], false);
      this.decoded.set(index, pubkey);
    }
    return pubkey;
  }

  getOrThrow(index: number): PublicKey {
    const pubkey = this.get(index);
    if (pubkey === undefined) throw Error(`Pubkey of validator ${index} is not in the cache`);
    return pubkey;
  }

  getPubkeyBytes(index: number): Uint8Array | undefined {
    return this.bytes[index];
  }

  getPubkeyBytesOrThrow(index: number): Uint8Array {
    const bytes = this.bytes[index];
    if (bytes === undefined) throw Error(`Pubkey of validator ${index} is not in the cache`);
    return bytes;
  }

  aggregate(indices: number[]): PublicKey {
    return aggregatePublicKeys(indices.map((index) => this.getOrThrow(index)));
  }

  getIndex(pubkey: Uint8Array): number | null {
    return this.indexByHex.get(toHex(pubkey)) ?? null;
  }

  append(index: number, pubkey: Uint8Array): void {
    if (index < this.bytes.length) {
      if (toHex(this.bytes[index]) !== toHex(pubkey)) throw Error(`Validator ${index} already has another pubkey`);
      return;
    }
    if (index !== this.bytes.length) throw Error(`Sparse append at ${index}, cache size ${this.bytes.length}`);
    this.bytes.push(pubkey);
    this.indexByHex.set(toHex(pubkey), index);
  }

  syncPubkeys(validators: {pubkey: Uint8Array}[]): void {
    for (let index = this.bytes.length; index < validators.length; index++) {
      this.append(index, validators[index].pubkey);
    }
  }

  load(): void {
    throw Error("LenientPubkeyCache does not load files");
  }

  save(): void {
    throw Error("LenientPubkeyCache does not save files");
  }

  reset(): void {
    this.bytes.length = 0;
    this.indexByHex.clear();
    this.decoded.clear();
  }

  ensureCapacity(): void {}
}
