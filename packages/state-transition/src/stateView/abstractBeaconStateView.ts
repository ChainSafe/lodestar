import {BitArray} from "@chainsafe/ssz";

/**
 * Base class for `BeaconStateView` implementations (NodeJS and future native).
 *
 * Subclasses surface a minimal `{uint8Array, bitLen}` shape via the abstract
 * `_executionPayloadAvailability` getter. The public `executionPayloadAvailability`
 * getter wraps that shape into a `BitArray` so beacon-node consumers are unaffected.
 */
export abstract class AbstractBeaconStateView {
  private _executionPayloadAvailabilityBitArray: BitArray | null = null;

  /** Raw shape that every backing implementation must provide. Throws before gloas. */
  protected abstract get _executionPayloadAvailability(): {uint8Array: Uint8Array; bitLen: number};

  get executionPayloadAvailability(): BitArray {
    if (this._executionPayloadAvailabilityBitArray === null) {
      const raw = this._executionPayloadAvailability;
      this._executionPayloadAvailabilityBitArray =
        raw instanceof BitArray ? raw : new BitArray(raw.uint8Array, raw.bitLen);
    }
    return this._executionPayloadAvailabilityBitArray;
  }
}
