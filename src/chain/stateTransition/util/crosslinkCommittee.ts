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
import {IBeaconConfig} from "../../../config";

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
export function getShuffledIndex(
  config: IBeaconConfig,
  index: ValidatorIndex,
  indexCount: number,
  seed: bytes32
): number {
  let permuted = index;
  assert(index < indexCount);
  assert(indexCount <= 2 ** 40);
  for (let i = 0; i < config.params.SHUFFLE_ROUND_COUNT; i++) {
    const pivot = bytesToBN(
      hash(Buffer.concat([seed, intToBytes(i, 1)]))
        .slice(0, 8)
    ).modn(indexCount);
    const flip = (pivot + indexCount - permuted) % indexCount;
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
export function getEpochCommitteeCount(config: IBeaconConfig, state: BeaconState, epoch: Epoch): number {
  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  return Math.max(
    1,
    Math.min(
      intDiv(config.params.SHARD_COUNT, config.params.SLOTS_PER_EPOCH),
      intDiv(intDiv(activeValidatorIndices.length, config.params.SLOTS_PER_EPOCH), config.params.TARGET_COMMITTEE_SIZE),
    ),
  ) * config.params.SLOTS_PER_EPOCH;
}

/**
 * Return the number of shards to increment ``state.latest_start_shard`` during ``epoch``.
 */
export function getShardDelta(config: IBeaconConfig, state: BeaconState, epoch: Epoch): number {
  return Math.min(
    getEpochCommitteeCount(config, state, epoch),
    config.params.SHARD_COUNT - intDiv(config.params.SHARD_COUNT, config.params.SLOTS_PER_EPOCH),
  );
}

export function getEpochStartShard(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Shard {
  const currentEpoch = getCurrentEpoch(config, state);
  let checkEpoch = currentEpoch + 1;
  assert(epoch <= checkEpoch);
  let shard = (state.latestStartShard + getShardDelta(config, state, currentEpoch)) % config.params.SHARD_COUNT;
  while (checkEpoch > epoch) {
    checkEpoch -= 1;
    shard = (shard + config.params.SHARD_COUNT - getShardDelta(config, state, checkEpoch)) % config.params.SHARD_COUNT;
  }
  return shard;
}

export function getAttestationDataSlot(config: IBeaconConfig, state: BeaconState, data: AttestationData): Slot {
  const epoch = data.targetEpoch;
  const committeeCount = getEpochCommitteeCount(config, state, epoch);
  const offset = (data.crosslink.shard + config.params.SHARD_COUNT - getEpochStartShard(config, state, epoch)) % config.params.SHARD_COUNT;
  return intDiv(getEpochStartSlot(config, epoch) + offset, intDiv(committeeCount, config.params.SLOTS_PER_EPOCH));
}

/**
 * Return the ``index``'th shuffled committee out of a total ``total_committees``
 * using ``validator_indices`` and ``seed``.
 */
export function computeCommittee(
  config: IBeaconConfig,
  indices: ValidatorIndex[],
  seed: bytes32,
  index: number,
  count: number
): ValidatorIndex[] {
  const start = intDiv(indices.length * index, count);
  const end = intDiv(indices.length * (index + 1), count);
  return Array.from({length: end - start},
    (_, i) => i + start)
    .map((i) => indices[getShuffledIndex(config, i, indices.length, seed)]);
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 */
export function getCrosslinkCommittee(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch,
  shard: Shard
): ValidatorIndex[] {
  return computeCommittee(
    config,
    getActiveValidatorIndices(state, epoch),
    generateSeed(config, state, epoch),
    (shard + config.params.SHARD_COUNT - getEpochStartShard(config, state, epoch)) % config.params.SHARD_COUNT,
    getEpochCommitteeCount(config, state, epoch)
  );
}
