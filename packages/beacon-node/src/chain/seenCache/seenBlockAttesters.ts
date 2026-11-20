import {Epoch, ValidatorIndex} from "@lodestar/types";
import {EPOCH_LOOKBACK_LIMIT} from "./seenAttesters.js";

/** A bitset per epoch, block import adds tens of thousands of indices per block on the main thread */
export class SeenBlockAttesters {
  private readonly bitsByEpoch = new Map<Epoch, Uint8Array>();
  private lowestPermissibleEpoch: Epoch = 0;
  private byteLength = 0;

  isKnown(epoch: Epoch, validatorIndex: ValidatorIndex): boolean {
    const bits = this.bitsByEpoch.get(epoch);
    // The index comes from API requests, the bitwise operators below would truncate it and alias a tracked index
    if (
      bits === undefined ||
      !Number.isInteger(validatorIndex) ||
      validatorIndex < 0 ||
      validatorIndex >= bits.length * 8
    ) {
      return false;
    }
    return (bits[validatorIndex >>> 3] & (1 << (validatorIndex & 7))) !== 0;
  }

  /** `validatorIndexes` must be indices of the validator registry */
  addIndices(epoch: Epoch, validatorIndexes: ValidatorIndex[]): void {
    if (epoch < this.lowestPermissibleEpoch) {
      throw Error(`EpochTooLow ${epoch} < ${this.lowestPermissibleEpoch}`);
    }

    let bits = this.bitsByEpoch.get(epoch);
    if (bits === undefined) {
      bits = new Uint8Array(this.byteLength);
      this.bitsByEpoch.set(epoch, bits);
    }

    for (const index of validatorIndexes) {
      const byteIndex = index >>> 3;
      if (byteIndex >= bits.length) {
        const grown: Uint8Array = new Uint8Array(Math.max(byteIndex + 1, bits.length * 2));
        grown.set(bits);
        bits = grown;
        this.bitsByEpoch.set(epoch, bits);
        this.byteLength = Math.max(this.byteLength, bits.length);
      }
      bits[byteIndex] |= 1 << (index & 7);
    }
  }

  prune(currentEpoch: Epoch): void {
    this.lowestPermissibleEpoch = Math.max(currentEpoch - EPOCH_LOOKBACK_LIMIT, 0);
    for (const epoch of this.bitsByEpoch.keys()) {
      if (epoch < this.lowestPermissibleEpoch) {
        this.bitsByEpoch.delete(epoch);
      }
    }
  }
}
