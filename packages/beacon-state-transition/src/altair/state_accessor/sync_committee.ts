import {aggregatePublicKeys} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, altair, ValidatorIndex, allForks} from "@chainsafe/lodestar-types";
import {intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

import {computeShuffledIndex, getActiveValidatorIndices, getSeed} from "../../util";

const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

/**
 * Return the sync committee indices for a given state and epoch.
 * Aligns `epoch` to `baseEpoch` so the result is the same with any `epoch` within a sync period
 */
export function getSyncCommitteeIndices(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  epoch: Epoch
): ValidatorIndex[] {
  const baseEpoch =
    (Math.max(intDiv(epoch, config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD), 1) - 1) *
    config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

  const activeValidatorIndices = getActiveValidatorIndices(state, baseEpoch);
  const activeValidatorCount = activeValidatorIndices.length;
  const seed = getSeed(config, state, baseEpoch, config.params.DOMAIN_SYNC_COMMITTEE);
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
export function getSyncCommittee(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  epoch: Epoch
): altair.SyncCommittee {
  const indices = getSyncCommitteeIndices(config, state, epoch);
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  const aggregates = [];
  for (let i = 0; i < pubkeys.length; i += config.params.SYNC_PUBKEYS_PER_AGGREGATE) {
    aggregates.push(
      aggregatePublicKeys(
        pubkeys.slice(i, i + config.params.SYNC_PUBKEYS_PER_AGGREGATE).map((pubkey) => pubkey.valueOf() as Uint8Array)
      )
    );
  }
  return {
    pubkeys,
    pubkeyAggregates: aggregates,
  };
}
