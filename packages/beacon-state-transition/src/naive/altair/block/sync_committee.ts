import {verifyAggregate} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, phase0 as phase0Types} from "@chainsafe/lodestar-types";
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
} from "../../../util";
import * as phase0 from "../../phase0";
import {getSyncCommitteeIndices} from "../../../altair/state_accessor";

export function processSyncCommittee(
  config: IBeaconConfig,
  state: altair.BeaconState,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const previousSlot = Math.max(state.slot, 1) - 1;
  const currentEpoch = getCurrentEpoch(config, state);
  const committeeIndices = getSyncCommitteeIndices(config, state, currentEpoch);
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
    const baseReward = phase0.getBaseReward(config, (state as unknown) as phase0Types.BeaconState, participantIndex);
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
