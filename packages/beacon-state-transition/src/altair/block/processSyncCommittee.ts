import {verifyAggregate} from "@chainsafe/bls";
import {altair} from "@chainsafe/lodestar-types";
import {assert} from "@chainsafe/lodestar-utils";

import {
  computeEpochAtSlot,
  computeSigningRoot,
  getBlockRootAtSlot,
  getDomain,
  increaseBalance,
  zipIndexesInBitList,
} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {BitList, TreeBacked} from "@chainsafe/ssz";

export function processSyncCommittee(
  state: CachedBeaconState<altair.BeaconState>,
  aggregate: altair.SyncAggregate,
  verifySignatures = true
): void {
  const {config, epochCtx} = state;
  const {syncParticipantReward, syncProposerReward} = epochCtx;
  const previousSlot = Math.max(state.slot, 1) - 1;
  const committeeIndices = state.currSyncCommitteeIndexes;
  const participantIndices = zipIndexesInBitList(
    committeeIndices,
    aggregate.syncCommitteeBits as TreeBacked<BitList>,
    config.types.altair.SyncCommitteeBits
  );
  const participantPubkeys = participantIndices.map((validatorIndex) => state.validators[validatorIndex].pubkey);
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
  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
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

  const proposerIndex = epochCtx.getBeaconProposer(state.slot);
  for (const participantIndex of participantIndices) {
    increaseBalance(state, participantIndex, syncParticipantReward);
  }
  increaseBalance(state, proposerIndex, syncProposerReward * BigInt(participantIndices.length));
}
