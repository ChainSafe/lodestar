import {BitArray} from "@chainsafe/ssz";

/**
 * Same to BitArray but it only so a copy on the 1st set to save memory.
 */
export class LazyBitArray {
  isDirty = false;
  bitArray: BitArray;
  constructor(bitArray: BitArray) {
    this.bitArray = bitArray;
  }

  set(bitIndex: number, bit: boolean): void {
    // only clone on the first set()
    if (!this.isDirty) {
      this.isDirty = true;
      this.bitArray = this.bitArray.clone();
    }
    this.bitArray.set(bitIndex, bit);
  }

  get(bitIndex: number): boolean {
    return this.bitArray.get(bitIndex);
  }

  clone(forceClone = false): LazyBitArray {
    if (forceClone) {
      this.bitArray = this.bitArray.clone();
    }
    // the real clone only happens on the 1st set
    return new LazyBitArray(this.bitArray);
  }
}

/**
 * Util class to build LazyBitArray.
 */
export class LazyBitArrayBuilder {
  private byte = 0;
  private bytes: Uint8Array;
  constructor(private bitLength: number) {
    this.bytes = new Uint8Array(Math.ceil(bitLength / 8));
  }

  append(i: number, value: boolean): void {
    if (value === true) {
      this.byte += 2 ** (i % 8);
    }

    if ((i + 1) % 8 === 0) {
      this.bytes[Math.floor(i / 8)] = this.byte;
      this.byte = 0;
    }
  }

  build(): LazyBitArray {
    if (this.byte !== 0) {
      const lastIndex = Math.floor((this.bitLength - 1) / 8);
      this.bytes[lastIndex] = this.byte;
    }
    return new LazyBitArray(new BitArray(this.bytes, this.bitLength));
  }
}

/**
 * Return LazyBitArray from an array of boolean
 */
export function buildLazyBitArray(arr: boolean[]): LazyBitArray {
  const builder = new LazyBitArrayBuilder(arr.length);

  for (let i = 0; i < arr.length; i++) {
    builder.append(i, arr[i]);
  }

  return builder.build();
}
