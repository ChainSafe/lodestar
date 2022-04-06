/**
 * @module chain/stateTransition/util
 */

import {digest} from "@chainsafe/as-sha256";
import {Epoch, Bytes32, DomainType, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert, bytesToBigInt, intToBytes} from "@chainsafe/lodestar-utils";
import {
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_SYNC_COMMITTEE,
  EFFECTIVE_BALANCE_INCREMENT,
  EPOCHS_PER_HISTORICAL_VECTOR,
  MAX_EFFECTIVE_BALANCE,
  MIN_SEED_LOOKAHEAD,
  SHUFFLE_ROUND_COUNT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {BeaconStateAllForks} from "../types.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {computeEpochAtSlot} from "./epoch.js";

/**
 * Compute proposer indices for an epoch
 */
export function computeProposers(
  state: BeaconStateAllForks,
  shuffling: {epoch: Epoch; activeIndices: ValidatorIndex[]},
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): number[] {
  const epochSeed = getSeed(state, shuffling.epoch, DOMAIN_BEACON_PROPOSER);
  const startSlot = computeStartSlotAtEpoch(shuffling.epoch);
  const proposers = [];
  for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(
        effectiveBalanceIncrements,
        shuffling.activeIndices,
        digest(Buffer.concat([epochSeed, intToBytes(slot, 8)]))
      )
    );
  }
  return proposers;
}

/**
 * Return from ``indices`` a random index sampled by effective balance.
 *
 * SLOW CODE - 🐢
 */
export function computeProposerIndex(
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: ValidatorIndex[],
  seed: Uint8Array
): ValidatorIndex {
  if (indices.length === 0) {
    throw Error("Validator indices must not be empty");
  }

  // TODO: Inline outside this function
  const MAX_RANDOM_BYTE = 2 ** 8 - 1;
  const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

  let i = 0;
  /* eslint-disable-next-line no-constant-condition */
  while (true) {
    const candidateIndex = indices[computeShuffledIndex(i % indices.length, indices.length, seed)];
    const randByte = digest(
      Buffer.concat([
        seed,
        //
        intToBytes(Math.floor(i / 32), 8, "le"),
      ])
    )[i % 32];

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randByte) {
      return candidateIndex;
    }
    i += 1;
    if (i === indices.length) {
      return -1;
    }
  }
}

/**
 * TODO: NAIVE
 *
 * Return the sync committee indices for a given state and epoch.
 * Aligns `epoch` to `baseEpoch` so the result is the same with any `epoch` within a sync period.
 *  Note: This function should only be called at sync committee period boundaries, as
 *  ``get_sync_committee_indices`` is not stable within a given period.
 *
 * SLOW CODE - 🐢
 */
export function getNextSyncCommitteeIndices(
  state: BeaconStateAllForks,
  activeValidatorIndices: ValidatorIndex[],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): ValidatorIndex[] {
  // TODO: Bechmark if it's necessary to inline outside of this function
  const MAX_RANDOM_BYTE = 2 ** 8 - 1;
  const MAX_EFFECTIVE_BALANCE_INCREMENT = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;

  const epoch = computeEpochAtSlot(state.slot) + 1;

  const activeValidatorCount = activeValidatorIndices.length;
  const seed = getSeed(state, epoch, DOMAIN_SYNC_COMMITTEE);
  let i = 0;
  const syncCommitteeIndices = [];
  while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
    const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
    const candidateIndex = activeValidatorIndices[shuffledIndex];
    const randByte = digest(
      Buffer.concat([
        seed,
        //
        intToBytes(Math.floor(i / 32), 8, "le"),
      ])
    )[i % 32];

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randByte) {
      syncCommitteeIndices.push(candidateIndex);
    }

    i++;
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
    const bit = (byte >> position % 8) % 2;
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
