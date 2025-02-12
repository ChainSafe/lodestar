import {digest} from "@chainsafe/as-sha256";
import {
  DOMAIN_SYNC_COMMITTEE,
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_SEED_LOOKAHEAD,
  SHUFFLE_ROUND_COUNT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {Bytes32, DomainType, Epoch, ValidatorIndex} from "@lodestar/types";
import {assert, bytesToBigInt, bytesToInt, intToBytes} from "@lodestar/utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {BeaconStateAllForks} from "../types.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {computeEpochAtSlot} from "./epoch.js";

/**
 * Compute proposer indices for an epoch
 */
export function computeProposers(
  fork: ForkSeq,
  epochSeed: Uint8Array,
  shuffling: {epoch: Epoch; activeIndices: ArrayLike<ValidatorIndex>},
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): number[] {
  const startSlot = computeStartSlotAtEpoch(shuffling.epoch);
  const proposers = [];
  for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(
        fork,
        effectiveBalanceIncrements,
        shuffling.activeIndices,
        // TODO: if we use hashTree, we can precompute the roots for the next n loops
        digest(Buffer.concat([epochSeed, intToBytes(slot, 8)]))
      )
    );
  }
  return proposers;
}

/**
 * Return from ``indices`` a random index sampled by effective balance.
 * This is just to make sure lodestar follows the spec, this is not for production.
 *
 * SLOW CODE - 🐢
 */
export function naiveComputeProposerIndex(
  fork: ForkSeq,
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: ArrayLike<ValidatorIndex>,
  seed: Uint8Array
): ValidatorIndex {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  if (fork >= ForkSeq.electra) {
    const MAX_RANDOM_VALUE = 2 ** 16 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

    let i = 0;
    while (true) {
      const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
      const randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8, "le")]));
      const offset = (i % 16) * 2;
      const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
        return candidateIndex;
      }

      i += 1;
    }
  } else {
    const MAX_RANDOM_BYTE = 2 ** 8 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

    let i = 0;
    while (true) {
      const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
      const randomByte = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 32), 8, "le")]))[i % 32];

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
        return candidateIndex;
      }

      i += 1;
    }
  }
}

/**
 * Optimized version of `naiveComputeProposerIndex`.
 * It shows > 3x speedup according to the perf test.
 */
export function computeProposerIndex(
  fork: ForkSeq,
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: ArrayLike<ValidatorIndex>,
  seed: Uint8Array
): ValidatorIndex {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  if (fork >= ForkSeq.electra) {
    // electra, see inline comments for the optimization
    const MAX_RANDOM_VALUE = 2 ** 16 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

    const shuffledIndexFn = getComputeShuffledIndexFn(indices.length, seed);
    // this simple cache makes sure we don't have to recompute the shuffled index for the next round of activeValidatorCount
    const shuffledResult = new Map<number, number>();

    let i = 0;
    const cachedHashInput = Buffer.allocUnsafe(32 + 8);
    cachedHashInput.set(seed, 0);
    cachedHashInput.writeUint32LE(0, 32 + 4);
    let cachedHash: Uint8Array | null = null;
    while (true) {
      // an optimized version of the below naive code
      // const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
      const index = i % indices.length;
      let shuffledIndex = shuffledResult.get(index);
      if (shuffledIndex == null) {
        shuffledIndex = shuffledIndexFn(index);
        shuffledResult.set(index, shuffledIndex);
      }
      const candidateIndex = indices[shuffledIndex];

      // compute a new hash every 16 iterations
      if (i % 16 === 0) {
        cachedHashInput.writeUint32LE(Math.floor(i / 16), 32);
        cachedHash = digest(cachedHashInput);
      }

      if (cachedHash == null) {
        // there is always a cachedHash, handle this to make the compiler happy
        throw new Error("cachedHash should not be null");
      }

      const randomBytes = cachedHash;
      const offset = (i % 16) * 2;
      // this is equivalent to bytesToInt(randomBytes.subarray(offset, offset + 2));
      // but it does not get through BigInt
      const lowByte = randomBytes[offset];
      const highByte = randomBytes[offset + 1];
      const randomValue = lowByte + highByte * 256;

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
        return candidateIndex;
      }

      i += 1;
    }
  } else {
    // preelectra, this function is the same to the naive version
    const MAX_RANDOM_BYTE = 2 ** 8 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

    let i = 0;
    while (true) {
      const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
      const randomByte = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 32), 8, "le")]))[i % 32];

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
        return candidateIndex;
      }

      i += 1;
    }
  }
}

/**
 * Naive version, this is not supposed to be used in production.
 * See `computeProposerIndex` for the optimized version.
 *
 * Return the sync committee indices for a given state and epoch.
 * Aligns `epoch` to `baseEpoch` so the result is the same with any `epoch` within a sync period.
 *  Note: This function should only be called at sync committee period boundaries, as
 *  ``get_sync_committee_indices`` is not stable within a given period.
 *
 * SLOW CODE - 🐢
 */
export function naiveGetNextSyncCommitteeIndices(
  fork: ForkSeq,
  state: BeaconStateAllForks,
  activeValidatorIndices: ArrayLike<ValidatorIndex>,
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): ValidatorIndex[] {
  const syncCommitteeIndices = [];

  if (fork >= ForkSeq.electra) {
    const MAX_RANDOM_VALUE = 2 ** 16 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

    const epoch = computeEpochAtSlot(state.slot) + 1;
    const activeValidatorCount = activeValidatorIndices.length;
    const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);

    let i = 0;
    while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
      const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
      const candidateIndex = activeValidatorIndices[shuffledIndex];
      const randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8, "le")]));
      const offset = (i % 16) * 2;
      const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
        syncCommitteeIndices.push(candidateIndex);
      }

      i += 1;
    }
  } else {
    const MAX_RANDOM_BYTE = 2 ** 8 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

    const epoch = computeEpochAtSlot(state.slot) + 1;
    const activeValidatorCount = activeValidatorIndices.length;
    const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);

    let i = 0;
    while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
      const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
      const candidateIndex = activeValidatorIndices[shuffledIndex];
      const randomByte = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 32), 8, "le")]))[i % 32];

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
        syncCommitteeIndices.push(candidateIndex);
      }

      i += 1;
    }
  }

  return syncCommitteeIndices;
}

/**
 * Optmized version of `naiveGetNextSyncCommitteeIndices`.
 *
 * In the worse case scenario, this could be >1000x speedup according to the perf test.
 */
export function getNextSyncCommitteeIndices(
  fork: ForkSeq,
  state: BeaconStateAllForks,
  activeValidatorIndices: ArrayLike<ValidatorIndex>,
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): ValidatorIndex[] {
  const syncCommitteeIndices = [];

  if (fork >= ForkSeq.electra) {
    // electra, see inline comments for the optimization
    const MAX_RANDOM_VALUE = 2 ** 16 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

    const epoch = computeEpochAtSlot(state.slot) + 1;
    const activeValidatorCount = activeValidatorIndices.length;
    const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);
    const shuffledIndexFn = getComputeShuffledIndexFn(activeValidatorCount, seed);

    let i = 0;
    let cachedHash: Uint8Array | null = null;
    const cachedHashInput = Buffer.allocUnsafe(32 + 8);
    cachedHashInput.set(seed, 0);
    cachedHashInput.writeUInt32LE(0, 32 + 4);
    // this simple cache makes sure we don't have to recompute the shuffled index for the next round of activeValidatorCount
    const shuffledResult = new Map<number, number>();
    while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
      // optimized version of the below naive code
      // const shuffledIndex = shuffledIndexFn(i % activeValidatorCount);
      const index = i % activeValidatorCount;
      let shuffledIndex = shuffledResult.get(index);
      if (shuffledIndex == null) {
        shuffledIndex = shuffledIndexFn(index);
        shuffledResult.set(index, shuffledIndex);
      }
      const candidateIndex = activeValidatorIndices[shuffledIndex];

      // compute a new hash every 16 iterations
      if (i % 16 === 0) {
        cachedHashInput.writeUint32LE(Math.floor(i / 16), 32);
        cachedHash = digest(cachedHashInput);
      }

      if (cachedHash == null) {
        // there is always a cachedHash, handle this to make the compiler happy
        throw new Error("cachedHash should not be null");
      }

      const randomBytes = cachedHash;
      const offset = (i % 16) * 2;

      // this is equivalent to bytesToInt(randomBytes.subarray(offset, offset + 2));
      // but it does not get through BigInt
      const lowByte = randomBytes[offset];
      const highByte = randomBytes[offset + 1];
      const randomValue = lowByte + highByte * 256;

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
        syncCommitteeIndices.push(candidateIndex);
      }

      i += 1;
    }
  } else {
    // pre-electra, keep the same naive version
    const MAX_RANDOM_BYTE = 2 ** 8 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

    const epoch = computeEpochAtSlot(state.slot) + 1;
    const activeValidatorCount = activeValidatorIndices.length;
    const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);

    let i = 0;
    while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
      const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
      const candidateIndex = activeValidatorIndices[shuffledIndex];
      const randomByte = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 32), 8, "le")]))[i % 32];

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
        syncCommitteeIndices.push(candidateIndex);
      }

      i += 1;
    }
  }

  return syncCommitteeIndices;
}

/**
 * Return the shuffled validator index corresponding to ``seed`` (and ``index_count``).
 *
 * Swap or not
 * https://link.springer.com/content/pdf/10.1007%2F978-3-642-32009-5_1.pdf
 *
 * See the 'generalized domain' algorithm on page 3.
 * This is the naive implementation just to make sure lodestar follows the spec, this is not for production.
 * The optimized version is in `getComputeShuffledIndexFn`.
 */
export function computeShuffledIndex(index: number, indexCount: number, seed: Bytes32): number {
  let permuted = index;
  assert.lt(index, indexCount, "indexCount must be less than index");
  assert.lte(indexCount, 2 ** 40, "indexCount too big");
  const _seed = seed;
  for (let i = 0; i < SHUFFLE_ROUND_COUNT; i++) {
    const pivot = Number(
      bytesToBigInt(digest(Buffer.concat([_seed, intToBytes(i, 1)])).slice(0, 8)) % BigInt(indexCount)
    );
    const flip = (pivot + indexCount - permuted) % indexCount;
    const position = Math.max(permuted, flip);
    const source = digest(Buffer.concat([_seed, intToBytes(i, 1), intToBytes(Math.floor(position / 256), 4)]));
    const byte = source[Math.floor((position % 256) / 8)];
    const bit = (byte >> (position % 8)) % 2;
    permuted = bit ? flip : permuted;
  }
  return permuted;
}

type ComputeShuffledIndexFn = (index: number) => number;

/**
 * An optimized version of `computeShuffledIndex`, this is for production.
 */
export function getComputeShuffledIndexFn(indexCount: number, seed: Bytes32): ComputeShuffledIndexFn {
  // there are possibly SHUFFLE_ROUND_COUNT (90 for mainnet) values for this cache
  // this cache will always hit after the 1st call
  const pivotByIndex: Map<number, number> = new Map();
  // given 2M active validators, there are 2 M / 256 = 8k possible positionDiv
  // it means there are at most 8k different sources for each round
  const sourceByPositionDivByIndex: Map<number, Map<number, Uint8Array>> = new Map();
  // 32 bytes seed + 1 byte i
  const pivotBuffer = Buffer.alloc(32 + 1);
  pivotBuffer.set(seed, 0);
  // 32 bytes seed + 1 byte i + 4 bytes positionDiv
  const sourceBuffer = Buffer.alloc(32 + 1 + 4);
  sourceBuffer.set(seed, 0);

  return (index): number => {
    assert.lt(index, indexCount, "indexCount must be less than index");
    assert.lte(indexCount, 2 ** 40, "indexCount too big");
    let permuted = index;
    const _seed = seed;
    for (let i = 0; i < SHUFFLE_ROUND_COUNT; i++) {
      // optimized version of the below naive code
      // const pivot = Number(
      //   bytesToBigInt(digest(Buffer.concat([_seed, intToBytes(i, 1)])).slice(0, 8)) % BigInt(indexCount)
      // );

      let pivot = pivotByIndex.get(i);
      if (pivot == null) {
        // naive version always creates a new buffer, we can reuse the buffer
        // pivot = Number(
        //   bytesToBigInt(digest(Buffer.concat([_seed, intToBytes(i, 1)])).slice(0, 8)) % BigInt(indexCount)
        // );
        pivotBuffer[32] = i % 256;
        pivot = Number(bytesToBigInt(digest(pivotBuffer).subarray(0, 8)) % BigInt(indexCount));
        pivotByIndex.set(i, pivot);
      }

      const flip = (pivot + indexCount - permuted) % indexCount;
      const position = Math.max(permuted, flip);

      // optimized version of the below naive code
      // const source = digest(Buffer.concat([_seed, intToBytes(i, 1), intToBytes(Math.floor(position / 256), 4)]));
      let sourceByPositionDiv = sourceByPositionDivByIndex.get(i);
      if (sourceByPositionDiv == null) {
        sourceByPositionDiv = new Map<number, Uint8Array>();
        sourceByPositionDivByIndex.set(i, sourceByPositionDiv);
      }
      const positionDiv256 = Math.floor(position / 256);
      let source = sourceByPositionDiv.get(positionDiv256);
      if (source == null) {
        // naive version always creates a new buffer, we can reuse the buffer
        // don't want to go through intToBytes() to avoid BigInt
        sourceBuffer[32] = i % 256;
        sourceBuffer.writeUint32LE(positionDiv256, 33);
        source = digest(sourceBuffer);
        sourceByPositionDiv.set(positionDiv256, source);
      }
      const byte = source[Math.floor((position % 256) / 8)];
      const bit = (byte >> (position % 8)) % 2;
      permuted = bit ? flip : permuted;
    }
    return permuted;
  };
}

/**
 * Return the randao mix at a recent [[epoch]].
 */
export function getRandaoMix(state: BeaconStateAllForks, epoch: Epoch): Bytes32 {
  return state.randaoMixes.get(epoch % EPOCHS_PER_HISTORICAL_VECTOR);
}

/**
 * Return the seed at [[epoch]].
 */
export function getSeed(state: BeaconStateAllForks, epoch: Epoch, domainType: DomainType): Uint8Array {
  const mix = getRandaoMix(state, epoch + EPOCHS_PER_HISTORICAL_VECTOR - MIN_SEED_LOOKAHEAD - 1);

  return digest(Buffer.concat([domainType as Buffer, intToBytes(epoch, 8), mix]));
}
