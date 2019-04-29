import assert from "assert";

import {
  BeaconState,
  bytes32,
  Epoch,
  Shard,
  Slot,
  ValidatorIndex,
} from "../../../types";

import {
  SHARD_COUNT,
  SHUFFLE_ROUND_COUNT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "../../../constants";

import {bytesToBN, intToBytes} from "../../../util/bytes";
import {hash} from "../../../util/crypto";
import {intDiv} from "../../../util/math";

import {
  getCurrentEpoch,
  getPreviousEpoch,
  slotToEpoch,
} from "./epoch";

import {getActiveValidatorIndices} from "./validator";

import {generateSeed} from "./seed";


/**
 * Return `p(index)` in a pseudorandom permutation `p` of `0...list_size - 1`
 * with ``seed`` as entropy.
 *
 * Utilizes 'swap or not' shuffling found in
 * https://link.springer.com/content/pdf/10.1007%2F978-3-642-32009-5_1.pdf
 * See the 'generalized domain' algorithm on page 3.
 * @param {number} index
 * @param {number} listSize
 * @param {seed} bytes32
 * @returns {number}
 */
export function getPermutedIndex(index: number, listSize: number, seed: bytes32): number {
  let permuted = index;
  assert(index < listSize);
  assert(listSize <= 2 ** 40);
  for (let i = 0; i < SHUFFLE_ROUND_COUNT; i++) {
    const pivot = bytesToBN(
      hash(Buffer.concat([seed, intToBytes(i, 1)]))
        .slice(0, 8)
    ).modn(listSize);
    const flip = (pivot - permuted) % listSize;
    const position = Math.max(permuted, flip);
    const source = hash(Buffer.concat([
      seed,
      intToBytes(i, 1),
      intToBytes(intDiv(position, 256), 4),
    ]));
    const byte = source[intDiv(position % 256, 8)];
    const bit = (byte >> (position % 8)) % 2;
    permuted = bit ? flip : permuted;
  }
  return permuted;
}

/**
 * Returns a value such that for a list L, chunk count k and index i,
 * split(L, k)[i] == L[get_split_offset(len(L), k, i): get_split_offset(len(L), k, i+1)]
 * @param {number} listSize
 * @param {number} chunks
 * @param {number} index
 * @returns {number}
 */
export function getSplitOffset(listSize: number, chunks: number, index: number): number {
  return intDiv(listSize * index, chunks);
}

/**
 * Return the number of committees in one epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {number}
 */
export function getEpochCommitteeCount(state: BeaconState, epoch: Epoch): number {
  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  return Math.max(
    1,
    Math.min(
      intDiv(SHARD_COUNT, SLOTS_PER_EPOCH),
      intDiv(intDiv(activeValidatorIndices.length, SLOTS_PER_EPOCH), TARGET_COMMITTEE_SIZE),
    ),
  ) * SLOTS_PER_EPOCH;
}

/**
 * Return the number of shards to increment ``state.latest_start_shard`` during ``epoch``.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {number}
 */
export function getShardDelta(state: BeaconState, epoch: Epoch): number {
  return Math.min(
    getEpochCommitteeCount(state, epoch),
    SHARD_COUNT - intDiv(SHARD_COUNT, SLOTS_PER_EPOCH),
  );
}

/**
 * Return the ``index``'th shuffled committee out of a total ``total_committees``
 * using ``validator_indices`` and ``seed``.
 * @param {ValidatorIndex[]} validatorIndices
 * @param {bytes32} seed
 * @param {number} index
 * @param {number} totalCommittees
 * @returns {ValidatorIndex[]}
 */
export function computeCommittee(validatorIndices: ValidatorIndex[], seed: bytes32, index: number, totalCommittees: number): ValidatorIndex[] {
  const startOffset = getSplitOffset(validatorIndices.length, totalCommittees, index);
  const endOffset = getSplitOffset(validatorIndices.length, totalCommittees, index + 1);
  return Array.from({length: endOffset - startOffset},
    (_, i) => i + startOffset)
    .map((i) => validatorIndices[getPermutedIndex(i, validatorIndices.length, seed)]);
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 * @param {BeaconState} state
 * @param {Slot} slot
 * @param {boolean} registryChange
 * @returns {[]}
 */
export function getCrosslinkCommitteesAtSlot(state: BeaconState, slot: Slot): [ValidatorIndex[], Shard][] {
  const epoch = slotToEpoch(slot);
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = getPreviousEpoch(state);
  const nextEpoch = currentEpoch + 1;

  assert(previousEpoch <= epoch && epoch <= nextEpoch);
  const indices = getActiveValidatorIndices(state, epoch);

  let startShard;
  if (epoch === currentEpoch) {
    startShard = state.latestStartShard;
  } else if (epoch === previousEpoch) {
    const previousShardDelta = getShardDelta(state, previousEpoch);
    startShard = (state.latestStartShard - previousShardDelta) % SHARD_COUNT;
  } else if (epoch === nextEpoch) {
    const currentShardDelta = getShardDelta(state, currentEpoch);
    startShard = (state.latestStartShard + currentShardDelta) % SHARD_COUNT;
  }

  const committeesPerEpoch = getEpochCommitteeCount(state, epoch);
  const committeesPerSlot = intDiv(committeesPerEpoch, SLOTS_PER_EPOCH);
  const offset = slot % SLOTS_PER_EPOCH;
  const slotStartShard = (startShard + committeesPerSlot * offset) % SHARD_COUNT;
  const seed = generateSeed(state, epoch);

  return Array.apply(null, Array(committeesPerSlot))
    .map((x, i): [ValidatorIndex[], Shard] => ([
      computeCommittee(indices, seed, committeesPerSlot * offset + i, committeesPerEpoch),
      (slotStartShard + i) % SHARD_COUNT,
    ]));
}
