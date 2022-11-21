import {BitArray} from "@chainsafe/ssz";

/**
 * Wrapper for BitArray that is only cloned when necessary.
 * - EpochContext.createFromState(), this cache is created to the correct length and pre-populated
 * - On processBlsToExecutionChange(), it's mutated if the credentials are changed
 * - On processDeposit(), it may be extended and set
 *
 * During block processing sets may be defered to prevent copying the bitArray more than once for each block.
 */
export class Eth1WithdrawalCredentialCache {
  private pendingSets: number[] = [];

  constructor(private bitArray: BitArray, private isMutable: boolean) {}

  static empty(): Eth1WithdrawalCredentialCache {
    return Eth1WithdrawalCredentialCache.fromZero(0);
  }

  static fromZero(validatorCount: number): Eth1WithdrawalCredentialCache {
    return new Eth1WithdrawalCredentialCache(
      BitArray.fromBitLen(validatorCount),
      // Can be mutated, BitArray in own by this cache
      true
    );
  }

  has(validatorIndex: number): boolean {
    return this.bitArray.get(validatorIndex);
  }

  /**
   * Set a validator as true. validatorIndex must be < this.bitArray length or it will throw an error.
   */
  add(validatorIndex: number): void {
    if (!this.isMutable) {
      this.bitArray = this.bitArray.clone();
      this.isMutable = true;
    }

    this.bitArray.set(validatorIndex, true);
  }

  /**
   * Set a validator as true. If it requires extending the bitArray length, it will defer to do so until
   * the this.applyPending() is called.
   */
  addPending(validatorIndex: number): void {
    if (validatorIndex > this.bitArray.bitLen) {
      this.pendingSets.push(validatorIndex);
    } else {
      this.add(validatorIndex);
    }
  }

  /**
   * Apply pending changes that need to extend bitArray length.
   * By applying all pending changes at once, it prevents unnecessary memory copying.
   */
  applyPending(): void {
    let maxIndex = this.bitArray.bitLen - 1;
    for (const validatorIndex of this.pendingSets) {
      if (validatorIndex > maxIndex) {
        maxIndex = validatorIndex;
      }
    }

    const uint8Array = new Uint8Array(maxIndex);
    uint8Array.set(this.bitArray.uint8Array);
    this.bitArray = new BitArray(uint8Array, maxIndex);
    this.isMutable = true;

    for (const validatorIndex of this.pendingSets) {
      this.bitArray.set(validatorIndex, true);
    }

    // Reset array
    this.pendingSets = [];
  }

  clone(): Eth1WithdrawalCredentialCache {
    return new Eth1WithdrawalCredentialCache(
      this.bitArray,
      // Can NOT be mutated, on the first this.set() the underlying BitArray will be cloned
      false
    );
  }
}
