import {altair, ssz} from "@chainsafe/lodestar-types";
import {DOMAIN_SYNC_COMMITTEE} from "@chainsafe/lodestar-params";

import {
  computeEpochAtSlot,
  computeSigningRoot,
  getBlockRootAtSlot,
  getDomain,
  increaseBalance,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
  zipIndexesInBitList,
} from "../../util";
import {CachedBeaconState} from "../../allForks/util";
import {BitList, isTreeBacked, TreeBacked} from "@chainsafe/ssz";

export function processSyncCommittee(
  state: CachedBeaconState<altair.BeaconState>,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  const {syncParticipantReward, syncProposerReward} = state.epochCtx;
  const participantIndices = getParticipantIndices(state, block.body.syncAggregate);

  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
  if (verifySignatures) {
    // This is to conform to the spec - we want the signature to be verified
    const signatureSet = getSyncCommitteeSignatureSet(state, block, participantIndices);
    // When there's no participation we consider the signature valid and just ignore i
    if (signatureSet !== null && !verifySignatureSet(signatureSet)) {
      throw Error("Sync committee signature invalid");
    }
  }

  const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
  for (const participantIndex of participantIndices) {
    increaseBalance(state, participantIndex, syncParticipantReward);
  }
  increaseBalance(state, proposerIndex, syncProposerReward * BigInt(participantIndices.length));
}

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconState<altair.BeaconState>,
  block: altair.BeaconBlock,
  /** Optional parameter to prevent computing it twice */
  participantIndices?: number[]
): ISignatureSet | null {
  const {epochCtx} = state;
  const {syncAggregate} = block.body;

  // The spec uses the state to get the previous slot
  // ```python
  // previous_slot = max(state.slot, Slot(1)) - Slot(1)
  // ```
  // However we need to run the function getSyncCommitteeSignatureSet() for all the blocks in a epoch
  // with the same state when verifying blocks in batch on RangeSync. Therefore we use the block.slot.
  //
  // This function expects that block.slot <= state.slot, otherwise we can't get the root sign by the sync committee.
  // process_sync_committee() is run at the end of process_block(). process_block() is run after process_slots()
  // which in the spec forces state.slot to equal block.slot.
  const previousSlot = Math.max(block.slot, 1) - 1;

  const rootSigned = getBlockRootAtSlot(state, previousSlot);

  if (!participantIndices) {
    participantIndices = getParticipantIndices(state, syncAggregate);
  }

  // When there's no participation we consider the signature valid and just ignore it
  if (participantIndices.length === 0) {
    return null;
  }

  const epochSig = computeEpochAtSlot(previousSlot);
  const domain = getDomain(state, DOMAIN_SYNC_COMMITTEE, epochSig);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: participantIndices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.Root, rootSigned, domain),
    signature: syncAggregate.syncCommitteeSignature.valueOf() as Uint8Array,
  };
}

/** Common logic for processSyncCommittee() and getSyncCommitteeSignatureSet() */
function getParticipantIndices(
  state: CachedBeaconState<altair.BeaconState>,
  syncAggregate: altair.SyncAggregate
): number[] {
  const committeeIndices = state.currSyncCommitteeIndexes;

  // the only time aggregate is not a TreeBacked is when producing a new block
  return isTreeBacked(syncAggregate)
    ? zipIndexesInBitList(
        committeeIndices,
        syncAggregate.syncCommitteeBits as TreeBacked<BitList>,
        ssz.altair.SyncCommitteeBits
      )
    : committeeIndices.filter((index) => !!syncAggregate.syncCommitteeBits[index]);
}
