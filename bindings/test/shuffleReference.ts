// Test oracle, ported with its dependencies inlined from
// https://github.com/ChainSafe/swap-or-not-shuffle/blob/main/test/referenceImplementation.ts
import {createHash} from "node:crypto";

export const SHUFFLE_ROUND_COUNT = 90;
export const EFFECTIVE_BALANCE_INCREMENT = 1_000_000_000;
export const MAX_EFFECTIVE_BALANCE = 32_000_000_000;
export const MAX_EFFECTIVE_BALANCE_ELECTRA = 2_048_000_000_000;
export const SYNC_COMMITTEE_SIZE = 512;
export const PTC_SIZE = 512;
export const SLOTS_PER_EPOCH = 32;

function digest(data: Uint8Array): Uint8Array {
  return createHash("sha256").update(data).digest();
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function intToBytesLE(value: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = BigInt(value);
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ArrayLike<number> but with settable indices
type Shuffleable = {
  [index: number]: number;
  readonly length: number;
};

// ShuffleList shuffles a list, using the given seed for randomness. Mutates the input list.
export function shuffleList(input: Shuffleable, seed: Uint8Array, rounds: number): void {
  innerShuffleList(input, seed, rounds, true);
}

// UnshuffleList undoes a list shuffling using the seed of the shuffling. Mutates the input list.
export function unshuffleList(input: Shuffleable, seed: Uint8Array, rounds: number): void {
  innerShuffleList(input, seed, rounds, false);
}

const _SHUFFLE_H_SEED_SIZE = 32;
const _SHUFFLE_H_ROUND_SIZE = 1;
const _SHUFFLE_H_POSITION_WINDOW_SIZE = 4;
const _SHUFFLE_H_PIVOT_VIEW_SIZE = _SHUFFLE_H_SEED_SIZE + _SHUFFLE_H_ROUND_SIZE;
const _SHUFFLE_H_TOTAL_SIZE = _SHUFFLE_H_SEED_SIZE + _SHUFFLE_H_ROUND_SIZE + _SHUFFLE_H_POSITION_WINDOW_SIZE;

function setPositionUint32(value: number, buf: Uint8Array): void {
  // Little endian, optimized version
  buf[_SHUFFLE_H_PIVOT_VIEW_SIZE] = (value >> 0) & 0xff;
  buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 1] = (value >> 8) & 0xff;
  buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 2] = (value >> 16) & 0xff;
  buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 3] = (value >> 24) & 0xff;
}

function isEqual<T>(actual: T, expected: T, message: string): void {
  if (!(actual === expected)) {
    throw new Error(`${message || "Expected values to be equal"}: ${actual} === ${expected}`);
  }
}

function isLte<T>(left: T, right: T, message: string): void {
  if (!(left <= right)) {
    throw new Error(`${message || "Expected value to be lte"}: ${left} <= ${right}`);
  }
}

// Shuffles or unshuffles, depending on the `dir` (true for shuffling, false for unshuffling).
// This TypeScript version is an adaption of @protolambda's Python/Go implementations.
function innerShuffleList(input: Shuffleable, seed: Uint8Array, rounds: number, dir: boolean): void {
  if (input.length <= 1) {
    // nothing to (un)shuffle
    return;
  }
  if (rounds === 0) {
    // no shuffling
    return;
  }
  const listSize = input.length >>> 0;
  isEqual(listSize, input.length, "input length does not fit uint32");
  isLte(seed.length, _SHUFFLE_H_SEED_SIZE, `seed length is not lte ${_SHUFFLE_H_SEED_SIZE} bytes`);

  const buf = new Uint8Array(_SHUFFLE_H_TOTAL_SIZE);
  let r = 0;
  if (!dir) {
    // Start at last round: iterating the rounds in reverse un-shuffles.
    r = rounds - 1;
  }

  // Seed is always the first 32 bytes of the hash input.
  buf.set(seed, 0);

  // initial values here are not used: overwritten first within the inner for loop.
  let source = seed;
  let byteV = 0;

  while (true) {
    // spec: pivot = bytes_to_int(hash(seed + int_to_bytes1(round))[0:8]) % list_size
    buf[_SHUFFLE_H_SEED_SIZE] = r;
    const h = digest(buf.subarray(0, _SHUFFLE_H_PIVOT_VIEW_SIZE));
    const pivot = Number(bytesToBigIntLE(h.subarray(0, 8)) % BigInt(listSize)) >>> 0;

    // Split the loop in two: [0, pivot] mirrored around pivot/2, then
    // (pivot, N) mirrored around (pivot/2 + size/2).
    let mirror = (pivot + 1) >> 1;
    setPositionUint32(pivot >> 8, buf);
    source = digest(buf);
    byteV = source[(pivot & 0xff) >> 3];

    for (let i = 0, j: number; i < mirror; i++) {
      j = pivot - i;
      if ((j & 0xff) === 0xff) {
        setPositionUint32(j >> 8, buf);
        source = digest(buf);
      }
      if ((j & 0x7) === 0x7) {
        byteV = source[(j & 0xff) >> 3];
      }
      const bitV = (byteV >> (j & 0x7)) & 0x1;
      if (bitV === 1) {
        const tmp = input[j];
        input[j] = input[i];
        input[i] = tmp;
      }
    }

    // Now repeat, but for the part after the pivot.
    mirror = (pivot + listSize + 1) >> 1;
    const end = listSize - 1;
    setPositionUint32(end >> 8, buf);
    source = digest(buf);
    byteV = source[(end & 0xff) >> 3];
    for (let i = pivot + 1, j: number; i < mirror; i++) {
      j = end - i + pivot + 1;
      if ((j & 0xff) === 0xff) {
        setPositionUint32(j >> 8, buf);
        source = digest(buf);
      }
      if ((j & 0x7) === 0x7) {
        byteV = source[(j & 0xff) >> 3];
      }
      const bitV = (byteV >> (j & 0x7)) & 0x1;
      if (bitV === 1) {
        const tmp = input[j];
        input[j] = input[i];
        input[i] = tmp;
      }
    }

    if (dir) {
      // -> shuffle
      r += 1;
      if (r === rounds) {
        break;
      }
    } else {
      if (r === 0) {
        break;
      }
      // -> un-shuffle
      r -= 1;
    }
  }
}

// spec compute_shuffled_index (inlined from @lodestar/state-transition)
export function computeShuffledIndex(index: number, indexCount: number, seed: Uint8Array): number {
  let permuted = index;
  for (let i = 0; i < SHUFFLE_ROUND_COUNT; i++) {
    const pivot = Number(
      bytesToBigIntLE(digest(concatBytes(seed, intToBytesLE(i, 1))).subarray(0, 8)) % BigInt(indexCount)
    );
    const flip = (pivot + indexCount - permuted) % indexCount;
    const position = Math.max(permuted, flip);
    const source = digest(concatBytes(seed, intToBytesLE(i, 1), intToBytesLE(Math.floor(position / 256), 4)));
    const byte = source[Math.floor((position % 256) / 8)];
    const bit = (byte >> (position % 8)) % 2;
    permuted = bit ? flip : permuted;
  }
  return permuted;
}

export type NaiveByteCount = 1 | 2;

// Direct TS port of the reference `get_committee_indices` sampling loop, built
// on the naive computeShuffledIndex.
function naiveGetCommitteeIndices(
  committeeSize: number,
  seed: Uint8Array,
  activeValidatorIndices: ArrayLike<number>,
  effectiveBalanceIncrements: Uint16Array,
  randByteCount: NaiveByteCount,
  maxEffectiveBalance: number
): number[] {
  const committeeIndices: number[] = [];
  const maxRandomValue = randByteCount === 1 ? 0xff : 0xffff;
  const hashIncrement = randByteCount === 1 ? 32 : 16;
  const maxEffectiveBalanceIncrement = maxEffectiveBalance / EFFECTIVE_BALANCE_INCREMENT;

  const activeValidatorCount = activeValidatorIndices.length;

  let i = 0;
  while (committeeIndices.length < committeeSize) {
    const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
    const candidateIndex = activeValidatorIndices[shuffledIndex];
    const randomBytes = digest(concatBytes(seed, intToBytesLE(Math.floor(i / hashIncrement), 8)));
    const randomValue =
      randByteCount === 1 ? randomBytes[i % 32] : randomBytes[(i % 16) * 2] + 256 * randomBytes[(i % 16) * 2 + 1];

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * maxRandomValue >= maxEffectiveBalanceIncrement * randomValue) {
      committeeIndices.push(candidateIndex);
    }

    i += 1;
  }

  return committeeIndices;
}

export function naiveComputeProposerIndex(
  seed: Uint8Array,
  activeValidatorIndices: ArrayLike<number>,
  effectiveBalanceIncrements: Uint16Array,
  randByteCount: NaiveByteCount,
  maxEffectiveBalance: number
): number {
  return naiveGetCommitteeIndices(
    1,
    seed,
    activeValidatorIndices,
    effectiveBalanceIncrements,
    randByteCount,
    maxEffectiveBalance
  )[0];
}

export function naiveComputeSyncCommitteeIndices(
  seed: Uint8Array,
  activeValidatorIndices: ArrayLike<number>,
  effectiveBalanceIncrements: Uint16Array,
  randByteCount: NaiveByteCount,
  maxEffectiveBalance: number
): number[] {
  return naiveGetCommitteeIndices(
    SYNC_COMMITTEE_SIZE,
    seed,
    activeValidatorIndices,
    effectiveBalanceIncrements,
    randByteCount,
    maxEffectiveBalance
  );
}

/// sync committee computation from lodestar, tweaked to avoid beacon state param
export function naiveComputeSyncCommitteeIndicesElectra(
  seed: Uint8Array,
  activeValidatorIndices: ArrayLike<number>,
  effectiveBalanceIncrements: Uint16Array
): number[] {
  return naiveComputeSyncCommitteeIndices(
    seed,
    activeValidatorIndices,
    effectiveBalanceIncrements,
    2,
    MAX_EFFECTIVE_BALANCE_ELECTRA
  );
}

/// PTC sampler from lodestar (naiveComputePayloadTimelinessCommitteeIndices),
/// ported from https://github.com/ChainSafe/swap-or-not-shuffle/pull/24
export function naiveComputePayloadTimelinessCommitteeIndices(
  effectiveBalanceIncrements: Uint16Array,
  indices: ArrayLike<number>,
  seed: Uint8Array
): number[] {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  const result: number[] = [];
  const maxRandomValue = 2 ** 16 - 1;
  const maxEffectiveBalanceIncrement = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

  let i = 0;
  while (result.length < PTC_SIZE) {
    const candidateIndex = indices[i % indices.length];
    const randomBytes = digest(concatBytes(seed, intToBytesLE(Math.floor(i / 16), 8)));
    const offset = (i % 16) * 2;
    const randomValue = randomBytes[offset] + 256 * randomBytes[offset + 1];

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * maxRandomValue >= maxEffectiveBalanceIncrement * randomValue) {
      result.push(candidateIndex);
    }
    i += 1;
  }

  return result;
}

/// epoch PTC from lodestar (computePayloadTimelinessCommitteesForEpoch),
/// tweaked to avoid beacon state param; ported from
/// https://github.com/ChainSafe/swap-or-not-shuffle/pull/24
export function naiveComputePayloadTimelinessCommitteesForEpoch(
  epochSeed: Uint8Array,
  startSlot: number,
  committees: Uint32Array[][],
  effectiveBalanceIncrements: Uint16Array
): number[][] {
  const result: number[][] = new Array(SLOTS_PER_EPOCH);
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const slotSeed = digest(concatBytes(epochSeed, intToBytesLE(startSlot + i, 8)));
    const slotCommittees = committees[i];
    let totalLen = 0;
    for (const c of slotCommittees) totalLen += c.length;
    const allIndices = new Uint32Array(totalLen);
    let offset = 0;
    for (const c of slotCommittees) {
      allIndices.set(c, offset);
      offset += c.length;
    }
    result[i] = naiveComputePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, allIndices, slotSeed);
  }
  return result;
}
