/** Shuffles `out` in place, no allocation. */
export declare function innerShuffleList(out: Uint32Array, seed: Uint8Array, rounds: number, forwards: boolean): void;

export declare function unshuffleList(activeIndices: Uint32Array, seed: Uint8Array, rounds: number): Uint32Array;

export declare function computeProposerIndex(
  seed: Uint8Array,
  activeIndices: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  randByteCount: 1 | 2,
  maxEffectiveBalance: number,
  effectiveBalanceIncrement: number,
  rounds: number
): number;

export declare function computeSyncCommitteeIndices(
  seed: Uint8Array,
  activeIndices: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  randByteCount: 1 | 2,
  syncCommitteeSize: number,
  maxEffectiveBalance: number,
  effectiveBalanceIncrement: number,
  rounds: number
): Uint32Array;

/** Samples the payload timeliness committee for one slot from its (pre-shuffled) indices. */
export declare function computePtcIndices(
  seed: Uint8Array,
  indices: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  ptcSize: number,
  maxEffectiveBalanceElectra: number,
  effectiveBalanceIncrement: number
): Uint32Array;

/**
 * Samples the payload timeliness committees for all slots of an epoch from
 * the flat epoch shuffling; `slotOffsets` (length slotsPerEpoch + 1) marks
 * each slot's window. Returns the concatenated per-slot committees
 * (slotsPerEpoch * ptcSize entries).
 */
export declare function computePtcIndicesForEpoch(
  epochSeed: Uint8Array,
  startSlot: number,
  slotsPerEpoch: number,
  shuffling: Uint32Array,
  slotOffsets: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  ptcSize: number,
  maxEffectiveBalanceElectra: number,
  effectiveBalanceIncrement: number
): Uint32Array;

/** Fills `out` (length = ptc size) instead of allocating a new array. */
export declare function computePtcIndicesInto(
  out: Uint32Array,
  seed: Uint8Array,
  indices: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  maxEffectiveBalanceElectra: number,
  effectiveBalanceIncrement: number
): void;

/** Fills `out` (length = slotsPerEpoch * ptcSize) instead of allocating a new array. */
export declare function computePtcIndicesForEpochInto(
  out: Uint32Array,
  epochSeed: Uint8Array,
  startSlot: number,
  slotsPerEpoch: number,
  shuffling: Uint32Array,
  slotOffsets: Uint32Array,
  effectiveBalanceIncrements: Uint16Array,
  ptcSize: number,
  maxEffectiveBalanceElectra: number,
  effectiveBalanceIncrement: number
): void;
