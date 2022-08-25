import {altair, ssz} from "@lodestar/types";
import {DOMAIN_SYNC_COMMITTEE} from "@lodestar/params";
import {byteArrayEquals} from "@chainsafe/ssz";
import {computeSigningRoot, ISignatureSet, SignatureSetType, verifySignatureSet} from "../util/index.js";
import {CachedBeaconStateAllForks} from "../types.js";
import {G2_POINT_AT_INFINITY} from "../constants/index.js";
import {getUnparticipantValues} from "../util/array.js";

export function processSyncAggregate(
  state: CachedBeaconStateAllForks,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  const {syncParticipantReward, syncProposerReward} = state.epochCtx;
  const committeeIndices = state.epochCtx.currentSyncCommitteeIndexed.validatorIndices;
  const participantIndices = block.body.syncAggregate.syncCommitteeBits.intersectValues(committeeIndices);
  const unparticipantIndices = getUnparticipantValues(participantIndices, committeeIndices);

  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
  if (verifySignatures) {
    // This is to conform to the spec - we want the signature to be verified
    const signatureSet = getSyncCommitteeSignatureSet(state, block, participantIndices);
    // When there's no participation we consider the signature valid and just ignore i
    if (signatureSet !== null && !verifySignatureSet(signatureSet)) {
      throw Error("Sync committee signature invalid");
    }
  }

  const balances = state.balances;

  // Proposer reward
  const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
  balances.set(proposerIndex, balances.get(proposerIndex) + syncProposerReward * participantIndices.length);

  // Positive rewards for participants
  for (const index of participantIndices) {
    balances.set(index, balances.get(index) + syncParticipantReward);
  }

  // Negative rewards for non participants
  for (const index of unparticipantIndices) {
    balances.set(index, balances.get(index) - syncParticipantReward);
  }
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
