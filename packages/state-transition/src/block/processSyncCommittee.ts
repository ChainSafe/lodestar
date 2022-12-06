import {altair, ssz} from "@lodestar/types";
import {DOMAIN_SYNC_COMMITTEE, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {byteArrayEquals} from "@chainsafe/ssz";
import {computeSigningRoot, ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {G2_POINT_AT_INFINITY} from "../constants/index.js";
import {decreaseBalance, increaseBalance} from "../util/index.js";

export function processSyncAggregate(
  state: CachedBeaconStateAllForks,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  const committeeIndices = state.epochCtx.currentSyncCommitteeIndexed.validatorIndices;

  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
  if (verifySignatures) {
    // This is to conform to the spec - we want the signature to be verified
    const participantIndices = block.body.syncAggregate.syncCommitteeBits.intersectValues(committeeIndices);
    const signatureSet = getSyncCommitteeSignatureSet(state, block, participantIndices);
    // When there's no participation we consider the signature valid and just ignore i
    if (signatureSet !== null && !verifySignatureSet(signatureSet)) {
      throw Error("Sync committee signature invalid");
    }
  }

  const {syncParticipantReward, syncProposerReward} = state.epochCtx;
  const {syncCommitteeBits} = block.body.syncAggregate;
  const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
  let proposerBalance = state.balances.get(proposerIndex);

  for (let i = 0; i < SYNC_COMMITTEE_SIZE; i++) {
    const index = committeeIndices[i];

    if (syncCommitteeBits.get(i)) {
      // Positive rewards for participants
      if (index === proposerIndex) {
        proposerBalance += syncParticipantReward;
      } else {
        increaseBalance(state, index, syncParticipantReward);
      }
      // Proposer reward
      proposerBalance += syncProposerReward;
    } else {
      // Negative rewards for non participants
      if (index === proposerIndex) {
        proposerBalance = Math.max(0, proposerBalance - syncParticipantReward);
      } else {
        decreaseBalance(state, index, syncParticipantReward);
      }
    }
  }

  // Apply proposer balance
  state.balances.set(proposerIndex, proposerBalance);
}

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconStateAllForks,
  block: altair.BeaconBlock,
  /** Optional parameter to prevent computing it twice */
  participantIndices?: number[]
): ISignatureSet | null {
  const {epochCtx} = state;
  const {syncAggregate} = block.body;
  const signature = syncAggregate.syncCommitteeSignature;

  // The spec uses the state to get the previous slot
  // ```python
  // previous_slot = max(state.slot, Slot(1)) - Slot(1)
  // ```
  // However we need to run the function getSyncCommitteeSignatureSet() for all the blocks in a epoch
  // with the same state when verifying blocks in batch on RangeSync. Therefore we use the block.slot.
  const previousSlot = Math.max(block.slot, 1) - 1;

  // The spec uses the state to get the root at previousSlot
  // ```python
  // get_block_root_at_slot(state, previous_slot)
  // ```
  // However we need to run the function getSyncCommitteeSignatureSet() for all the blocks in a epoch
  // with the same state when verifying blocks in batch on RangeSync.
  //
  // On skipped slots state block roots just copy the latest block, so using the parentRoot here is equivalent.
  // So getSyncCommitteeSignatureSet() can be called with a state in any slot (with the correct shuffling)
  const rootSigned = block.parentRoot;

  if (!participantIndices) {
    const committeeIndices = state.epochCtx.currentSyncCommitteeIndexed.validatorIndices;
    participantIndices = syncAggregate.syncCommitteeBits.intersectValues(committeeIndices);
  }

  // When there's no participation we consider the signature valid and just ignore it
  if (participantIndices.length === 0) {
    // Must set signature as G2_POINT_AT_INFINITY when participating bits are empty
    // https://github.com/ethereum/eth2.0-specs/blob/30f2a076377264677e27324a8c3c78c590ae5e20/specs/altair/bls.md#eth2_fast_aggregate_verify
    if (byteArrayEquals(signature, G2_POINT_AT_INFINITY)) {
      return null;
    } else {
      throw Error("Empty sync committee signature is not infinity");
    }
  }

  const domain = state.config.getDomain(state.slot, DOMAIN_SYNC_COMMITTEE, previousSlot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: participantIndices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.Root, rootSigned, domain),
    signature,
  };
}
