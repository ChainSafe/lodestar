import {aggregatePublicKeys} from "@chainsafe/bls";
import {
  DOMAIN_SYNC_COMMITTEE,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  MAX_EFFECTIVE_BALANCE,
  SYNC_COMMITTEE_SIZE,
  SYNC_PUBKEYS_PER_AGGREGATE,
} from "@chainsafe/lodestar-params";
import {Epoch, altair, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

import {computeShuffledIndex, getActiveValidatorIndices, getSeed} from "../../util";

const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

/**
 * Return the sync committee indices for a given state and epoch.
 * Aligns `epoch` to `baseEpoch` so the result is the same with any `epoch` within a sync period
 */
export function getSyncCommitteeIndices(state: allForks.BeaconState, epoch: Epoch): ValidatorIndex[] {
  const baseEpoch =
    (Math.max(intDiv(epoch, EPOCHS_PER_SYNC_COMMITTEE_PERIOD), 1) - 1) * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

  const activeValidatorIndices = getActiveValidatorIndices(state, baseEpoch);
  const activeValidatorCount = activeValidatorIndices.length;
  const seed = getSeed(state, baseEpoch, DOMAIN_SYNC_COMMITTEE);
  let i = 0;
  const syncCommitteeIndices = [];
  while (syncCommitteeIndices.length < SYNC_COMMITTEE_SIZE) {
    const shuffledIndex = computeShuffledIndex(i % activeValidatorCount, activeValidatorCount, seed);
    const candidateIndex = activeValidatorIndices[shuffledIndex];
    const randomByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, 32), 8, "le")]))[i % 32];
    const effectiveBalance = state.validators[candidateIndex].effectiveBalance;
    if (effectiveBalance * MAX_RANDOM_BYTE >= MAX_EFFECTIVE_BALANCE * BigInt(randomByte)) {
      syncCommitteeIndices.push(candidateIndex);
    }
    i++;
  }
  return syncCommitteeIndices;
}

/**
 * Return the sync committee for a given state and epoch.
 */
export function getSyncCommittee(state: allForks.BeaconState, epoch: Epoch): altair.SyncCommittee {
  const indices = getSyncCommitteeIndices(state, epoch);
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  const aggregates = [];
  for (let i = 0; i < pubkeys.length; i += SYNC_PUBKEYS_PER_AGGREGATE) {
    aggregates.push(
      aggregatePublicKeys(
        pubkeys.slice(i, i + SYNC_PUBKEYS_PER_AGGREGATE).map((pubkey) => pubkey.valueOf() as Uint8Array)
      )
    );
  }
  return {
    pubkeys,
    pubkeyAggregates: aggregates,
  };
}
