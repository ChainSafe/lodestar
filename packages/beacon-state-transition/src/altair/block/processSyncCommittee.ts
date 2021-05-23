import {verifyAggregate} from "@chainsafe/bls";
import {altair} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";

import {
  computeEpochAtSlot,
  computeSigningRoot,
  getActiveValidatorIndices,
  getBlockRootAtSlot,
  getCurrentEpoch,
  getDomain,
  getBeaconProposerIndex,
  increaseBalance,
} from "../../util";
import * as phase0 from "../../phase0";
import * as naive from "../../naive";
import {CachedBeaconState} from "../../allForks/util";

export function processSyncCommittee(
  state: CachedBeaconState<altair.BeaconState>,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const {config} = state;
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(config, state);
  const committeeIndices = state.currSyncCommitteeIndexes;
  const participantIndices = committeeIndices.filter((index) => !!aggregate.syncCommitteeBits[index]);
  const committeePubkeys = Array.from(state.currentSyncCommittee.pubkeys);
  const participantPubkeys = committeePubkeys.filter((pubkey, index) => !!aggregate.syncCommitteeBits[index]);
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
  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate
  if (verifySignatures && participantIndices.length > 0) {
    assert.true(
      verifyAggregate(
        participantPubkeys.map((pubkey) => pubkey.valueOf() as Uint8Array),
        signingRoot,
        aggregate.syncCommitteeSignature.valueOf() as Uint8Array
      ),
      "Sync committee signature invalid"
    );
  }

  let participantRewards = BigInt(0);
  const activeValidatorCount = BigInt(getActiveValidatorIndices(state, currentEpoch).length);
  for (const participantIndex of participantIndices) {
    // eslint-disable-next-line import/namespace
    const baseReward = naive.phase0.getBaseReward(config, (state as unknown) as phase0.BeaconState, participantIndex);
    const reward =
      (baseReward * activeValidatorCount) / BigInt(committeeIndices.length) / BigInt(config.params.SLOTS_PER_EPOCH);
    increaseBalance(state, participantIndex, reward);
    participantRewards += reward;
  }
  increaseBalance(
    state,
    getBeaconProposerIndex(config, state),
    participantRewards / BigInt(config.params.PROPOSER_REWARD_QUOTIENT)
  );
}
