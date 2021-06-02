import {verifyAggregate} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0 as phase0Types, ssz} from "@chainsafe/lodestar-types";
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
} from "../../../util";
import * as phase0 from "../../phase0";

export function processSyncCommittee(
  config: IBeaconConfig,
  state: altair.BeaconState,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(state);
  const allPubkeys = Array.from(state.validators).map((validator) => validator.pubkey);
  const committeeIndices = [];
  for (const committeePubkey of state.currentSyncCommittee.pubkeys) {
    for (const [index, pubkey] of allPubkeys.entries()) {
      if (ssz.BLSPubkey.equals(pubkey, committeePubkey)) {
        committeeIndices.push(index);
      }
    }
  }
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
    const baseReward = phase0.getBaseReward((state as unknown) as phase0Types.BeaconState, participantIndex);
    const reward = (baseReward * activeValidatorCount) / BigInt(committeeIndices.length) / BigInt(SLOTS_PER_EPOCH);
    increaseBalance(state, participantIndex, reward);
    participantRewards += reward;
  }
  increaseBalance(state, getBeaconProposerIndex(state), participantRewards / BigInt(PROPOSER_REWARD_QUOTIENT));
}
