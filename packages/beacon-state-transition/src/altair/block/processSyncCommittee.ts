import {altair, ssz, ValidatorIndex} from "@chainsafe/lodestar-types";
import {DOMAIN_SYNC_COMMITTEE} from "@chainsafe/lodestar-params";

import {
  computeSigningRoot,
  getBlockRootAtSlot,
  ISignatureSet,
  SignatureSetType,
  verifySignatureSet,
  zipAllIndexesSyncCommitteeBits,
  zipIndexesSyncCommitteeBits,
} from "../../util";
import {CachedBeaconStateAltair} from "../../types";
import {G2_POINT_AT_INFINITY} from "../../constants";

export function processSyncAggregate(
  state: CachedBeaconStateAltair,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  const {syncParticipantReward, syncProposerReward} = state.epochCtx;
  const [participantIndices, unparticipantIndices] = getParticipantInfo(state, block.body.syncAggregate);

  // different from the spec but not sure how to get through signature verification for default/empty SyncAggregate in the spec test
  if (verifySignatures) {
    // This is to conform to the spec - we want the signature to be verified
    const signatureSet = getSyncCommitteeSignatureSet(state, block, participantIndices);
    // When there's no participation we consider the signature valid and just ignore i
    if (signatureSet !== null && !verifySignatureSet(signatureSet)) {
      throw Error("Sync committee signature invalid");
    }
  }
  const deltaByIndex = new Map<ValidatorIndex, number>();
  const proposerIndex = state.epochCtx.getBeaconProposer(state.slot);
  for (const participantIndex of participantIndices) {
    accumulateDelta(deltaByIndex, participantIndex, syncParticipantReward);
  }
  accumulateDelta(deltaByIndex, proposerIndex, syncProposerReward * participantIndices.length);
  for (const unparticipantIndex of unparticipantIndices) {
    accumulateDelta(deltaByIndex, unparticipantIndex, -syncParticipantReward);
  }
  state.balanceList.applyDeltaInBatch(deltaByIndex);
}

export function getSyncCommitteeSignatureSet(
  state: CachedBeaconStateAltair,
  block: altair.BeaconBlock,
  /** Optional parameter to prevent computing it twice */
  participantIndices?: number[]
): ISignatureSet | null {
  const {epochCtx} = state;
  const {syncAggregate} = block.body;
  const signature = syncAggregate.syncCommitteeSignature.valueOf() as Uint8Array;

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
    // Must set signature as G2_POINT_AT_INFINITY when participating bits are empty
    // https://github.com/ethereum/eth2.0-specs/blob/30f2a076377264677e27324a8c3c78c590ae5e20/specs/altair/bls.md#eth2_fast_aggregate_verify
    if (ssz.BLSSignature.equals(signature, G2_POINT_AT_INFINITY)) {
      return null;
    } else {
      throw Error("Empty sync committee signature is not infinity");
    }
  }

  const domain = state.config.getDomain(DOMAIN_SYNC_COMMITTEE, previousSlot);

  return {
    type: SignatureSetType.aggregate,
    pubkeys: participantIndices.map((i) => epochCtx.index2pubkey[i]),
    signingRoot: computeSigningRoot(ssz.Root, rootSigned, domain),
    signature,
  };
}

/** Get participant indices for a sync committee. */
function getParticipantIndices(state: CachedBeaconStateAltair, syncAggregate: altair.SyncAggregate): number[] {
  const committeeIndices = state.epochCtx.currentSyncCommitteeIndexed.validatorIndices;
  return zipIndexesSyncCommitteeBits(committeeIndices, syncAggregate.syncCommitteeBits);
}

/** Return [0] as participant indices and [1] as unparticipant indices for a sync committee. */
function getParticipantInfo(state: CachedBeaconStateAltair, syncAggregate: altair.SyncAggregate): [number[], number[]] {
  const committeeIndices = state.epochCtx.currentSyncCommitteeIndexed.validatorIndices;
  return zipAllIndexesSyncCommitteeBits(committeeIndices, syncAggregate.syncCommitteeBits);
}

function accumulateDelta(deltaByIndex: Map<ValidatorIndex, number>, index: ValidatorIndex, delta: number): void {
  const existingDelta = deltaByIndex.get(index);
  if (existingDelta === undefined) {
    deltaByIndex.set(index, delta);
  } else {
    deltaByIndex.set(index, delta + existingDelta);
  }
}
