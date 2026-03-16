import {digest} from "@chainsafe/as-sha256";
import {
  computeProposerIndex as nativeComputeProposerIndex,
  computeSyncCommitteeIndices as nativeComputeSyncCommitteeIndices,
} from "@chainsafe/swap-or-not-shuffle";
import {
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_PTC_ATTESTER,
  DOMAIN_SYNC_COMMITTEE,
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_SEED_LOOKAHEAD,
  PTC_SIZE,
  SHUFFLE_ROUND_COUNT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {Bytes32, DomainType, Epoch, Slot, ValidatorIndex} from "@lodestar/types";
import {assert, bytesToBigInt, bytesToInt, intToBytes} from "@lodestar/utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "../types.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

/**
 * Compute proposer indices for an epoch
 */
export function computeProposers(
  fork: ForkSeq,
  epochSeed: Uint8Array,
  shuffling: {epoch: Epoch; activeIndices: Uint32Array},
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
  indices: Uint32Array,
  seed: Uint8Array
): ValidatorIndex {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  let maxEffectiveBalance: number;
  let randByteCount: number;
  if (fork >= ForkSeq.electra) {
    maxEffectiveBalance = MAX_EFFECTIVE_BALANCE_ELECTRA;
    randByteCount = 2;
  } else {
    maxEffectiveBalance = MAX_EFFECTIVE_BALANCE;
    randByteCount = 1;
  }

  return nativeComputeProposerIndex(
    seed,
    indices,
    effectiveBalanceIncrements,
    randByteCount,
    maxEffectiveBalance,
    EFFECTIVE_BALANCE_INCREMENT,
    SHUFFLE_ROUND_COUNT
  );
}

/**
 * Return the proposer indices for the given `epoch`.
 * A more generic version of `computeProposers`
 */
export function computeProposerIndices(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  shuffling: {activeIndices: Uint32Array},
  epoch: Epoch
): ValidatorIndex[] {
  const startSlot = computeStartSlotAtEpoch(epoch);
  const proposers = [];
  const epochSeed = getSeed(state, epoch, DOMAIN_BEACON_PROPOSER);

  for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(
        fork,
        state.epochCtx.effectiveBalanceIncrements,
        shuffling.activeIndices,
        digest(Buffer.concat([epochSeed, intToBytes(slot, 8)]))
      )
    );
  }
  return proposers;
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
  const syncCommitteeValidatorIndices = [];

  if (fork >= ForkSeq.electra) {
    const MAX_RANDOM_VALUE = 2 ** 16 - 1;
    const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

    const epoch = computeEpochAtSlot(state.slot) + 1;
    const activeValidatorCount = activeValidatorIndices.length;
    const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);

    let i = 0;
    while (syncCommitteeValidatorIndices.length < SYNC_COMMITTEE_SIZE) {
      const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
      const candidateIndex = activeValidatorIndices[shuffledIndex];
      const randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8, "le")]));
      const offset = (i % 16) * 2;
      const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
        syncCommitteeValidatorIndices.push(candidateIndex);
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
    while (syncCommitteeValidatorIndices.length < SYNC_COMMITTEE_SIZE) {
      const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
      const candidateIndex = activeValidatorIndices[shuffledIndex];
      const randomByte = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 32), 8, "le")]))[i % 32];

      const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
      if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
        syncCommitteeValidatorIndices.push(candidateIndex);
      }

      i += 1;
    }
  }

  return syncCommitteeValidatorIndices;
}

/**
 * Optmized version of `naiveGetNextSyncCommitteeIndices`.
 *
 * In the worse case scenario, this could be >1000x speedup according to the perf test.
 */
export function getNextSyncCommitteeIndices(
  fork: ForkSeq,
  state: BeaconStateAllForks,
  activeValidatorIndices: Uint32Array,
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): Uint32Array {
  let maxEffectiveBalance: number;
  let randByteCount: number;

  if (fork >= ForkSeq.electra) {
    maxEffectiveBalance = MAX_EFFECTIVE_BALANCE_ELECTRA;
    randByteCount = 2;
  } else {
    maxEffectiveBalance = MAX_EFFECTIVE_BALANCE;
    randByteCount = 1;
  }

  const epoch = computeEpochAtSlot(state.slot) + 1;
  const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);
  return nativeComputeSyncCommitteeIndices(
    seed,
    activeValidatorIndices,
    effectiveBalanceIncrements,
    randByteCount,
    SYNC_COMMITTEE_SIZE,
    maxEffectiveBalance,
    EFFECTIVE_BALANCE_INCREMENT,
    SHUFFLE_ROUND_COUNT
  );
}

/**
 * Compute PTC for a single slot.
 */
export function computePayloadTimelinessCommitteeAtSlot(
  state: BeaconStateAllForks,
  slot: Slot,
  slotCommittees: Uint32Array[],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  const epochSeed = getSeed(state, epoch, DOMAIN_PTC_ATTESTER);
  const slotSeedInput = new Uint8Array(epochSeed.length + 8);
  slotSeedInput.set(epochSeed, 0);
  const slotSeedView = new DataView(slotSeedInput.buffer, slotSeedInput.byteOffset, slotSeedInput.byteLength);

  slotSeedView.setUint32(epochSeed.length, slot, true);
  slotSeedView.setUint32(epochSeed.length + 4, 0, true);

  return computePayloadTimelinessCommitteeForSlot(digest(slotSeedInput), slotCommittees, effectiveBalanceIncrements);
}

/**
 * Compute PTC for all slots in an epoch eagerly.
 */
export function computePayloadTimelinessCommitteesForEpoch(
  state: BeaconStateAllForks,
  epoch: number,
  committees: Uint32Array[][],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): Uint32Array[] {
  const startSlot = epoch * SLOTS_PER_EPOCH;
  const result: Uint32Array[] = new Array(SLOTS_PER_EPOCH);

  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const slot = startSlot + i;
    result[i] = computePayloadTimelinessCommitteeAtSlot(state, slot, committees[i], effectiveBalanceIncrements);
  }
  return result;
}

/**
 * Compute PTC for a single slot.
 */
export function computePayloadTimelinessCommitteeForSlot(
  slotSeed: Uint8Array,
  slotCommittees: Uint32Array[],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): Uint32Array {
  // Concatenate all committee Uint32Arrays for this slot
  const totalLen = slotCommittees.reduce((sum, c) => sum + c.length, 0);
  const allIndices = new Uint32Array(totalLen);
  let offset = 0;
  for (const c of slotCommittees) {
    allIndices.set(c, offset);
    offset += c.length;
  }
  return computePayloadTimelinessCommitteeIndices(effectiveBalanceIncrements, allIndices, slotSeed);
}

/**
 * Optimized version of PTC indices computation.
 * Avoids BigInt conversions and uses DataView for efficient byte reading.
 */
export function computePayloadTimelinessCommitteeIndices(
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: Uint32Array,
  seed: Uint8Array
): Uint32Array {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  const result = new Uint32Array(PTC_SIZE);
  let resultLen = 0;

  const MAX_RANDOM_VALUE = 0xffff; // 2^16 - 1
  const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;
  const indicesLen = indices.length;

  // Pre-allocate hash input buffer: seed + 8 bytes for block index
  const hashInput = new Uint8Array(seed.length + 8);
  hashInput.set(seed, 0);
  const hashInputView = new DataView(hashInput.buffer, hashInput.byteOffset, hashInput.byteLength);
  const seedLen = seed.length;

  let i = 0;
  let randomBytesView: DataView = new DataView(new ArrayBuffer(0));
  let lastBlock = -1;

  while (resultLen < PTC_SIZE) {
    const candidateIndex = indices[i % indicesLen];

    // Only recompute hash every 16 iterations
    const block = i >>> 4; // Math.floor(i / 16)
    if (block !== lastBlock) {
      // Write block as little-endian uint64 (block always fits in uint32 range)
      hashInputView.setUint32(seedLen, block, true);
      hashInputView.setUint32(seedLen + 4, 0, true);
      const randomBytes = digest(hashInput);
      randomBytesView = new DataView(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength);
      lastBlock = block;
    }

    const randomValue = randomBytesView.getUint16((i & 15) * 2, true);

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
      result[resultLen++] = candidateIndex;
    }
    i += 1;
  }

  return result;
}

/**
 * Naive version of PTC indices computation.
 * Used to verify the optimized `computePayloadTimelinessCommitteeIndices`.
 *
 * SLOW CODE - 🐢
 */
export function naiveComputePayloadTimelinessCommitteeIndices(
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: ArrayLike<ValidatorIndex>,
  seed: Uint8Array
): ValidatorIndex[] {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  const result = [];

  const MAX_RANDOM_VALUE = 2 ** 16 - 1;
  const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

  let i = 0;
  while (result.length < PTC_SIZE) {
    const candidateIndex = indices[i % indices.length];
    const randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8, "le")]));
    const offset = (i % 16) * 2;
    const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * MAX_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomValue) {
      result.push(candidateIndex);
    }
    i += 1;
  }

  return result;
}

/**
 * Return the shuffled validator index corresponding to ``seed`` (and ``index_count``).
 *
 * Swap or not
 * https://link.springer.com/content/pdf/10.1007%2F978-3-642-32009-5_1.pdf
 *
 * See the 'generalized domain' algorithm on page 3.
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
