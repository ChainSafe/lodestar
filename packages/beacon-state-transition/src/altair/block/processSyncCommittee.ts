import {verifyAggregate} from "@chainsafe/bls";
import {altair, ssz, phase0} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";
import {DOMAIN_SYNC_COMMITTEE, PROPOSER_REWARD_QUOTIENT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

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
import * as naive from "../../naive";
import {getSyncCommitteeIndices} from "../state_accessor";
import {CachedBeaconState} from "../../allForks/util";

export function processSyncCommittee(
  state: CachedBeaconState<altair.BeaconState>,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(state);
  const committeeIndices = getSyncCommitteeIndices(state, currentEpoch);
  const participantIndices = committeeIndices.filter((index) => !!aggregate.syncCommitteeBits[index]);
  const committeePubkeys = Array.from(state.currentSyncCommittee.pubkeys);
  const participantPubkeys = committeePubkeys.filter((pubkey, index) => !!aggregate.syncCommitteeBits[index]);
  const domain = getDomain(state, DOMAIN_SYNC_COMMITTEE, computeEpochAtSlot(previousSlot));
  const signingRoot = computeSigningRoot(ssz.Root, getBlockRootAtSlot(state, previousSlot), domain);
  if (verifySignatures) {
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
    const baseReward = naive.phase0.getBaseReward((state as unknown) as phase0.BeaconState, participantIndex);
    const reward = (baseReward * activeValidatorCount) / BigInt(committeeIndices.length) / BigInt(SLOTS_PER_EPOCH);
    increaseBalance(state, participantIndex, reward);
    participantRewards += reward;
  }
  increaseBalance(state, getBeaconProposerIndex(state), participantRewards / PROPOSER_REWARD_QUOTIENT);
}
