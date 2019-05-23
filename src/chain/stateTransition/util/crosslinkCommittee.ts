/**
 * @module chain/stateTransition/util
 */

import assert from "assert";

import {
  BeaconState,
  bytes32,
  Epoch,
  Shard,
  Slot,
  ValidatorIndex,
  AttestationData,
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
  getEpochStartSlot,
} from "./epoch";

import {getActiveValidatorIndices} from "./validator";

import {generateSeed} from "./seed";


/**
 * Return the shuffled validator index corresponding to ``seed`` (and ``index_count``).
 *
 * Swap or not
 * https://link.springer.com/content/pdf/10.1007%2F978-3-642-32009-5_1.pdf
 *
 * See the 'generalized domain' algorithm on page 3.
 */
export function getShuffledIndex(index: ValidatorIndex, indexCount: number, seed: bytes32): number {
  let permuted = index;
  assert(index < indexCount);
  assert(indexCount <= 2 ** 40);
  for (let i = 0; i < SHUFFLE_ROUND_COUNT; i++) {
    const pivot = bytesToBN(
      hash(Buffer.concat([seed, intToBytes(i, 1)]))
        .slice(0, 8)
    ).modn(indexCount);
    const flip = (pivot - permuted) % indexCount;
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
 */
export function getSplitOffset(listSize: number, chunks: number, index: number): number {
  return intDiv(listSize * index, chunks);
}

/**
 * Return the number of committees in one epoch.
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
 */
export function getShardDelta(state: BeaconState, epoch: Epoch): number {
  return Math.min(
    getEpochCommitteeCount(state, epoch),
    SHARD_COUNT - intDiv(SHARD_COUNT, SLOTS_PER_EPOCH),
  );
}

export function getEpochStartShard(state: BeaconState, epoch: Epoch): Shard {
  const currentEpoch = getCurrentEpoch(state);
  let checkEpoch = currentEpoch + 1;
  assert(epoch <= checkEpoch);
  let shard = (state.latestStartShard + getShardDelta(state, currentEpoch)) % SHARD_COUNT;
  while (checkEpoch > epoch) {
    checkEpoch -= 1;
    shard = (shard + SHARD_COUNT - getShardDelta(state, checkEpoch)) % SHARD_COUNT;
  }
  return shard;
}

export function getAttestationDataSlot(state: BeaconState, data: AttestationData): Slot {
  const epoch = data.targetEpoch;
  const committeeCount = getEpochCommitteeCount(state, epoch);
  const offset = (data.shard + SHARD_COUNT - getEpochStartShard(state, epoch)) % SHARD_COUNT;
  return intDiv(getEpochStartSlot(epoch) + offset, intDiv(committeeCount, SLOTS_PER_EPOCH));
}

/**
 * Return the ``index``'th shuffled committee out of a total ``total_committees``
 * using ``validator_indices`` and ``seed``.
 */
export function computeCommittee(
  indices: ValidatorIndex[],
  seed: bytes32,
  index: number,
  count: number
): ValidatorIndex[] {
  const start = intDiv(indices.length * index, count);
  const end = intDiv(indices.length * (index + 1), count);
  return Array.from({length: end - start},
    (_, i) => i + start)
    .map((i) => indices[getShuffledIndex(i, indices.length, seed)]);
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 */
export function getCrosslinkCommittee(
  state: BeaconState,
  epoch: Epoch,
  shard: Shard
): ValidatorIndex[] {
  return computeCommittee(
    getActiveValidatorIndices(state, epoch),
    generateSeed(state, epoch),
    (shard + SHARD_COUNT - getEpochStartShard(state, epoch)) % SHARD_COUNT,
    getEpochCommitteeCount(state, epoch)
  );
}
