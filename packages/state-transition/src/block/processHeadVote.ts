import {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot, ValidatorIndex, eip8453} from "@lodestar/types";
import {CachedBeaconStateEip8453} from "../types.js";
import {getHeadVoteCommittee, getHeadVoteSigningRoot, isHeadVoteSameSlot} from "../util/eip8453.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {createAggregateSignatureSetFromComponents, verifySignatureSet} from "../util/signatureSets.js";

/** Head vote committees of the block being processed, computed once per slot */
export type HeadVoteCommitteeCache = Map<Slot, Uint32Array>;

export function getHeadVoteCommitteeCached(
  state: CachedBeaconStateEip8453,
  slot: Slot,
  cache: HeadVoteCommitteeCache
): Uint32Array {
  let committee = cache.get(slot);
  if (committee === undefined) {
    committee = getHeadVoteCommittee(state, slot);
    cache.set(slot, committee);
  }
  return committee;
}

/**
 * Spec: process_head_vote
 *
 * Head votes belong to the available chain. The beacon state records only which seats voted for the block of
 * their slot, to weigh builder payments.
 */
export function processHeadVote(
  state: CachedBeaconStateEip8453,
  vote: eip8453.HeadVote,
  committeeCache: HeadVoteCommitteeCache,
  verifySignature = true
): void {
  const {data} = vote;
  const currentEpoch = state.epochCtx.epoch;
  const previousEpoch = state.epochCtx.previousShuffling.epoch;
  const voteEpoch = computeEpochAtSlot(data.slot);

  if (data.slot + MIN_ATTESTATION_INCLUSION_DELAY > state.slot) {
    throw Error(`Head vote slot ${data.slot} is too recent for state slot ${state.slot}`);
  }
  if (voteEpoch !== previousEpoch && voteEpoch !== currentEpoch) {
    throw Error(`Head vote epoch ${voteEpoch} is neither the previous nor the current epoch`);
  }

  const committee = getHeadVoteCommitteeCached(state, data.slot, committeeCache);
  // A validator holding several seats has its signature counted once per seat, matching get_aggregate_head_vote
  const voterIndices: ValidatorIndex[] = [];
  for (const position of vote.aggregationBits.getTrueBitIndexes()) {
    voterIndices.push(committee[position]);
  }
  if (voterIndices.length === 0) {
    throw Error("Head vote has no participants");
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

  // Record the seats that voted for the block of their slot
  if (isHeadVoteSameSlot(state, data)) {
    const participationIndex =
      voteEpoch === currentEpoch ? SLOTS_PER_EPOCH + (data.slot % SLOTS_PER_EPOCH) : data.slot % SLOTS_PER_EPOCH;
    const participation = state.headVoteParticipation.get(participationIndex);
    for (const position of vote.aggregationBits.getTrueBitIndexes()) {
      participation.set(position, true);
    }
  }
}
