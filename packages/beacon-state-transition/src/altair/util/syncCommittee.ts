import {aggregatePublicKeys} from "@chainsafe/bls";
import {
  DOMAIN_SYNC_COMMITTEE,
  EFFECTIVE_BALANCE_INCREMENT,
  MAX_EFFECTIVE_BALANCE,
  SYNC_COMMITTEE_SIZE,
} from "@chainsafe/lodestar-params";
import {altair, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";
import {EffectiveBalanceIncrements} from "../../allForks/util/effectiveBalanceIncrements";

import {computeEpochAtSlot, computeShuffledIndex, getSeed} from "../../util";

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
  state: allForks.BeaconState,
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
    const randomByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, 32), 8, "le")]))[i % 32];

    const effectiveBalanceIncrement = effectiveBalanceIncrements[candidateIndex];
    if (effectiveBalanceIncrement * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE_INCREMENT * randomByte) {
      syncCommitteeIndices.push(candidateIndex);
    }

    i++;
  }
  return syncCommitteeIndices;
}

/**
 * Return the sync committee for a given state and epoch.
 *
 * SLOW CODE - 🐢
 */
export function getNextSyncCommittee(
  state: allForks.BeaconState,
  activeValidatorIndices: ValidatorIndex[],
  effectiveBalanceIncrements: EffectiveBalanceIncrements
): altair.SyncCommittee {
  const indices = getNextSyncCommitteeIndices(state, activeValidatorIndices, effectiveBalanceIncrements);
  // Using the index2pubkey cache is slower because it needs the serialized pubkey.
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  return {
    pubkeys,
    aggregatePubkey: aggregatePublicKeys(pubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array)),
  };
}
