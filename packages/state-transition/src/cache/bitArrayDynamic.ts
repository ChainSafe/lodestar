import {BitArray} from "@chainsafe/ssz";

/**
 * Wrapper for BitArray whose underlying ArrayBuffer is only cloned when necessary.
 */
export class BitArrayAutoResize {
  private pendingSets: number[] = [];

  constructor(private bitArray: BitArray, private isMutable: boolean) {}

  static empty(): BitArrayAutoResize {
    return BitArrayAutoResize.fillZero(0);
  }

  static fillZero(bitLen: number): BitArrayAutoResize {
    return new BitArrayAutoResize(
      BitArray.fromBitLen(bitLen),
      // Can be mutated, BitArray in own by this cache
      true
    );
  }

  has(index: number): boolean {
    return this.bitArray.get(index);
  }

  /**
   * If `index` is >= than BitArray's length returns false instead of throwing an error
   */
  hasInRange(index: number): boolean {
    if (index >= this.bitArray.bitLen) {
      return false;
    }
    return this.bitArray.get(index);
  }

  /**
   * Set a validator as true. validatorIndex must be < this.bitArray length or it will throw an error.
   */
  add(index: number): void {
    if (!this.isMutable) {
      this.bitArray = this.bitArray.clone();
      this.isMutable = true;
    }

    this.bitArray.set(index, true);
  }

  /**
   * Set a validator as true. If it requires extending the bitArray length, it will defer to do so until
   * the this.applyPending() is called.
   */
  addPending(index: number): void {
    if (index > this.bitArray.bitLen) {
      this.pendingSets.push(index);
    } else {
      this.add(index);
    }
  }

  /**
   * Apply pending changes that need to extend bitArray length.
   * By applying all pending changes at once, it prevents unnecessary memory copying.
   */
  applyPending(): void {
    let maxIndex = this.bitArray.bitLen - 1;
    for (const index of this.pendingSets) {
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    const uint8Array = new Uint8Array(maxIndex);
    uint8Array.set(this.bitArray.uint8Array);
    this.bitArray = new BitArray(uint8Array, maxIndex);
    this.isMutable = true;

    for (const index of this.pendingSets) {
      this.bitArray.set(index, true);
    }

    // Reset array
    this.pendingSets = [];
  }

  clone(): BitArrayAutoResize {
    return new BitArrayAutoResize(
      this.bitArray,
      // Can NOT be mutated, on the first this.set() the underlying BitArray will be cloned
      false
    );
  }
}
