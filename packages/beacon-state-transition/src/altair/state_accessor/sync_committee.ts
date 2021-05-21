import {aggregatePublicKeys} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

import {computeEpochAtSlot, computeShuffledIndex, getActiveValidatorIndices, getSeed} from "../../util";

const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

/**
 * Return the sync committee indices for a given state and epoch.
 * Aligns `epoch` to `baseEpoch` so the result is the same with any `epoch` within a sync period.
 *  Note: This function should only be called at sync committee period boundaries, as
    ``get_sync_committee_indices`` is not stable within a given period.
 */
export function getNextSyncCommitteeIndices(config: IBeaconConfig, state: allForks.BeaconState): ValidatorIndex[] {
  const epoch = computeEpochAtSlot(config, state.slot) + 1;

  const activeValidatorIndices = getActiveValidatorIndices(state, epoch);
  const activeValidatorCount = activeValidatorIndices.length;
  const seed = getSeed(config, state, epoch, config.params.DOMAIN_SYNC_COMMITTEE);
  let i = 0;
  const syncCommitteeIndices = [];
  while (syncCommitteeIndices.length < config.params.SYNC_COMMITTEE_SIZE) {
    const shuffledIndex = computeShuffledIndex(config, i % activeValidatorCount, activeValidatorCount, seed);
    const candidateIndex = activeValidatorIndices[shuffledIndex];
    const randomByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, 32), 8, "le")]))[i % 32];
    const effectiveBalance = state.validators[candidateIndex].effectiveBalance;
    if (effectiveBalance * MAX_RANDOM_BYTE >= config.params.MAX_EFFECTIVE_BALANCE * BigInt(randomByte)) {
      syncCommitteeIndices.push(candidateIndex);
    }
    i++;
  }
  return syncCommitteeIndices;
}

/**
 * Return the sync committee for a given state and epoch.
 */
export function getNextSyncCommittee(config: IBeaconConfig, state: allForks.BeaconState): altair.SyncCommittee {
  const indices = getNextSyncCommitteeIndices(config, state);
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  return {
    pubkeys,
    aggregatePubkey: aggregatePublicKeys(pubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array)),
  };
}
