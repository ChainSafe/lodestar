import {aggregatePublicKeys, verifyAggregate} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, lightclient, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert, intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";

import {
  computeEpochAtSlot,
  computeShuffledIndex,
  computeSigningRoot,
  getActiveValidatorIndices,
  getBlockRootAtSlot,
  getCurrentEpoch,
  getDomain,
  getBeaconProposerIndex,
  getSeed,
  increaseBalance,
} from "../../util";
import {phase0} from "../../";

const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

export function processSyncCommittee(
  config: IBeaconConfig,
  state: lightclient.BeaconState & phase0.BeaconState,
  block: lightclient.BeaconBlock
): void {
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(config, state);
  const committeeIndices = getSyncCommitteeIndices(config, state, currentEpoch);
  const participantIndices = committeeIndices.filter((index) => !!block.body.syncCommitteeBits[index]);
  const committeePubkeys = Array.from(state.currentSyncCommittee.pubkeys);
  const participantPubkeys = committeePubkeys.filter((pubkey, index) => !!block.body.syncCommitteeBits[index]);
  const domain = getDomain(
    config,
    state,
    config.params.DOMAIN_SYNC_COMMITTEE,
    computeEpochAtSlot(config, previousSlot)
  );
  const signingRoot = computeSigningRoot(
    config,
    config.types.Root,
    getBlockRootAtSlot(config, state, previousSlot),
    domain
  );
  assert.true(
    verifyAggregate(
      participantPubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array),
      signingRoot,
      block.body.syncCommitteeSignature.valueOf() as Uint8Array
    ),
    "Sync committee signature invalid"
  );

  let participantRewards = BigInt(0);
  const activeValidatorCount = BigInt(getActiveValidatorIndices(state, currentEpoch).length);
  participantIndices.forEach((participantIndex) => {
    const baseReward = phase0.getBaseReward(config, state, participantIndex);
    const reward =
      (baseReward * activeValidatorCount) / BigInt(committeeIndices.length) / BigInt(config.params.SLOTS_PER_EPOCH);
    increaseBalance(state, participantIndex, reward);
    participantRewards += reward;
  });
  increaseBalance(
    state,
    getBeaconProposerIndex(config, state),
    participantRewards / BigInt(config.params.PROPOSER_REWARD_QUOTIENT)
  );
}

/**
 * Return the sync committee indices for a given state and epoch.
 */
export function   getSyncCommitteeIndices(
  config: IBeaconConfig,
  state: lightclient.BeaconState | phase0.BeaconState,
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
  state: lightclient.BeaconState | phase0.BeaconState,
  epoch: Epoch
): lightclient.SyncCommittee {
  const indices = getSyncCommitteeIndices(config, state, epoch);
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  const aggregates = [];
  for (let i = 0; i < pubkeys.length; i += config.params.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE) {
    aggregates.push(
      aggregatePublicKeys(
        pubkeys
          .slice(i, i + config.params.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE)
          .map((pubkey) => pubkey.valueOf() as Uint8Array)
      )
    );
  }
  return {
    pubkeys,
    pubkeyAggregates: aggregates,
  };
}
