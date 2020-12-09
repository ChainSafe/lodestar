import {aggregatePublicKeys, verifyAggregate} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, LightClient, ValidatorIndex} from "@chainsafe/lodestar-types";
import {assert, intDiv, intToBytes} from "@chainsafe/lodestar-utils";
import {hash} from "@chainsafe/ssz";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  getActiveValidatorIndices,
  getBlockRootAtSlot,
  getCurrentEpoch,
  getDomain,
  getBeaconProposerIndex,
} from "../util";
import {computeShuffledIndex, getSeed} from "../util/seed";
import {getBaseReward} from "../epoch/balanceUpdates/util";
import {increaseBalance} from "../util/balance";

const MAX_RANDOM_BYTE = BigInt(2 ** 8 - 1);

export function processSyncCommittee(
  config: IBeaconConfig,
  state: LightClient.BeaconState,
  block: LightClient.BeaconBlock
): void {
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(config, state);
  const committeeIndices = getSyncCommitteeIndices(config, state, currentEpoch);
  const participantIndices = committeeIndices.filter((index) => !!block.syncCommitteeBits[index]);
  const committeePubkeys = Array.from(state.currentSyncCommittee.pubkeys);
  const participantPubkeys = committeePubkeys.filter((pubkey, index) => !!block.syncCommitteeBits[index]);
  const domain = getDomain(
    config,
    state,
    config.params.lightclient.DOMAIN_SYNC_COMMITTEE,
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
      block.syncCommitteeSignature.valueOf() as Uint8Array
    ),
    "Sync committee signature invalid"
  );

  let participantRewards = BigInt(0);
  const activeValidatorCount = BigInt(getActiveValidatorIndices(state, currentEpoch).length);
  participantIndices.forEach((participantIndex) => {
    const baseReward = getBaseReward(config, state, participantIndex);
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
export function getSyncCommitteeIndices(
  config: IBeaconConfig,
  state: LightClient.BeaconState,
  epoch: Epoch
): ValidatorIndex[] {
  const baseEpoch =
    (Math.max(intDiv(epoch, config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD), 1) - 1) *
    config.params.lightclient.EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

  const activeValidatorIndices = getActiveValidatorIndices(state, baseEpoch);
  const activeValidatorCount = activeValidatorIndices.length;
  const seed = getSeed(config, state, baseEpoch, config.params.lightclient.DOMAIN_SYNC_COMMITTEE);
  let i = 0;
  const syncCommitteeIndices = [];
  while (syncCommitteeIndices.length < config.params.lightclient.SYNC_COMMITTEE_SIZE) {
    const shuffledIndex = computeShuffledIndex(config, i % activeValidatorCount, activeValidatorCount, seed);
    const candidateIndex = activeValidatorIndices[shuffledIndex];
    const randomByte = hash(Buffer.concat([seed, intToBytes(intDiv(i, activeValidatorCount), 4, "le")]))[i % 32];
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
  state: LightClient.BeaconState,
  epoch: Epoch
): LightClient.SyncCommittee {
  const indices = getSyncCommitteeIndices(config, state, epoch);
  const pubkeys = indices.map((index) => state.validators[index].pubkey);
  const aggregates = [];
  for (let i = 0; i < pubkeys.length; i += config.params.lightclient.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE) {
    aggregates.push(
      aggregatePublicKeys(
        pubkeys
          .slice(i, i + config.params.lightclient.SYNC_COMMITTEE_PUBKEY_AGGREGATES_SIZE)
          .map((pubkey) => pubkey.valueOf() as Uint8Array)
      )
    );
  }
  return {
    pubkeys,
    pubkeyAggregates: aggregates,
  };
}
