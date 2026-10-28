import {
  MIN_ATTESTATION_INCLUSION_DELAY,
  PAYLOAD_STATUS_EMPTY,
  PAYLOAD_STATUS_FULL,
  PAYLOAD_STATUS_PENDING,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {eip8453} from "@lodestar/types";
import {CachedBeaconStateEip8453} from "../types.js";
import {getHeadVoteCommittee, getHeadVoteSigningRoot, isHeadVoteSameSlot} from "../util/eip8453.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {createAggregateSignatureSetFromComponents, verifySignatureSet} from "../util/signatureSets.js";

/**
 * Spec: process_head_vote
 *
 * Head votes belong to the available chain. The beacon state records only which seats voted for the block of
 * their slot, to weigh builder payments. `supportBits` has one bit per voter and marks the voters the proposer
 * counted as support, which is only allowed for votes of the previous slot.
 */
export function processHeadVote(
  state: CachedBeaconStateEip8453,
  vote: eip8453.HeadVote,
  supportBits: eip8453.HeadVoteSupportBits,
  verifySignature = true
): void {
  const {data, voterIndices} = vote;
  const currentEpoch = state.epochCtx.epoch;
  const previousEpoch = state.epochCtx.previousShuffling.epoch;
  const voteEpoch = computeEpochAtSlot(data.slot);

  if (data.slot + MIN_ATTESTATION_INCLUSION_DELAY > state.slot) {
    throw Error(`Head vote slot ${data.slot} is too recent for state slot ${state.slot}`);
  }
  if (voteEpoch !== previousEpoch && voteEpoch !== currentEpoch) {
    throw Error(`Head vote epoch ${voteEpoch} is neither the previous nor the current epoch`);
  }
  if (
    data.payloadStatus !== PAYLOAD_STATUS_EMPTY &&
    data.payloadStatus !== PAYLOAD_STATUS_FULL &&
    data.payloadStatus !== PAYLOAD_STATUS_PENDING
  ) {
    throw Error(`Head vote payload status ${data.payloadStatus} is not valid`);
  }
  const sameSlot = isHeadVoteSameSlot(state, data);
  if (sameSlot && data.payloadStatus !== PAYLOAD_STATUS_PENDING) {
    throw Error(`Head vote for the block of its slot must have payload status PENDING, got ${data.payloadStatus}`);
  }

  const committee = getHeadVoteCommittee(state, data.slot);
  if (voterIndices.length === 0) {
    throw Error("Head vote has no voters");
  }
  const committeeSet = new Set(committee);
  for (let i = 0; i < voterIndices.length; i++) {
    const index = voterIndices[i];
    if (i > 0 && index <= voterIndices[i - 1]) {
      throw Error(`Head vote voter indices are not sorted and unique at position ${i}`);
    }
    if (!committeeSet.has(index)) {
      throw Error(`Head vote voter ${index} is not in the committee of slot ${data.slot}`);
    }
  }

  if (supportBits.bitLen !== voterIndices.length) {
    throw Error(`Head vote support bits length ${supportBits.bitLen} != voters ${voterIndices.length}`);
  }
  if (supportBits.getTrueBitIndexes().length > 0 && data.slot !== state.slot - 1) {
    throw Error(`Supported head vote of slot ${data.slot} is not of the previous slot ${state.slot - 1}`);
  }

  if (verifySignature) {
    const signatureSet = createAggregateSignatureSetFromComponents(
      voterIndices,
      getHeadVoteSigningRoot(state, data),
      vote.signature
    );
    if (!verifySignatureSet(signatureSet)) {
      throw Error("Head vote signature is not valid");
    }
  }

  // Record the seats that voted for the block of their slot; a validator with several seats fills all of them
  if (sameSlot) {
    const participationIndex =
      voteEpoch === currentEpoch ? SLOTS_PER_EPOCH + (data.slot % SLOTS_PER_EPOCH) : data.slot % SLOTS_PER_EPOCH;
    const participation = state.headVoteParticipation.get(participationIndex);
    const voterSet = new Set(voterIndices);
    for (let position = 0; position < committee.length; position++) {
      if (voterSet.has(committee[position])) {
        participation.set(position, true);
      }
    }
  }
}
