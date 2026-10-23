import {
  FINALITY_FLAG_INDEX,
  FINALITY_WEIGHT,
  PROGRESS_FLAG_INDEX,
  PROGRESS_WEIGHT,
  PROPOSER_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {eip8453} from "@lodestar/types";
import {CachedBeaconStateEip8453} from "../types.js";
import {
  getIndexedAttestationEip8453,
  getRoundRewardPerIncrement,
  heightCheckpointEquals,
  heightCheckpointToStr,
  isValidAggregationBits,
  isValidAttestationData,
  isValidIndexedAttestationEip8453,
  isWellFormedAttestationData,
  readHeightCheckpoint,
} from "../util/eip8453.js";
import {computeEpochAtSlot} from "../util/epoch.js";
import {increaseBalance} from "../util/index.js";

const PROPOSER_REWARD_DIVISOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

/**
 * Spec: process_attestation [Modified in EIP8453]
 *
 * Flags are credited only the first time a validator's progress or finality participation is recorded, and count
 * toward the round in which the attestation is included.
 */
export function processAttestationsEip8453(
  state: CachedBeaconStateEip8453,
  attestations: eip8453.Attestation[],
  verifySignature = true
): void {
  const {epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const currentEpoch = epochCtx.epoch;
  const finalizedEpoch = computeEpochAtSlot(state.finalizedSlot);
  const rewardPerIncrement = getRoundRewardPerIncrement(state);
  const targetCheckpoint = readHeightCheckpoint(state.targetCheckpoint);
  const {targetParticipation, progressParticipation, roundParticipation, pendingFinality} = state;
  const pendingCheckpoints = pendingFinality
    .getAllReadonly()
    .map((pending) => readHeightCheckpoint(pending.checkpoint));

  let proposerReward = 0;

  for (const attestation of attestations) {
    const {data} = attestation;
    if (!isWellFormedAttestationData(data)) {
      throw Error(
        `Malformed attestation data: target=${heightCheckpointToStr(data.target)} finality=${heightCheckpointToStr(data.finality)}`
      );
    }
    if (!isValidAttestationData(state, data)) {
      throw Error(
        `Attestation data does not match the state: target=${heightCheckpointToStr(data.target)} finality=${heightCheckpointToStr(data.finality)} stateTarget=${heightCheckpointToStr(targetCheckpoint)}`
      );
    }
    if (attestation.epoch > currentEpoch) {
      throw Error(`Attestation epoch ${attestation.epoch} is after the current epoch ${currentEpoch}`);
    }
    if (attestation.epoch < finalizedEpoch) {
      throw Error(`Attestation epoch ${attestation.epoch} is before the finalized epoch ${finalizedEpoch}`);
    }
    if (!isValidAggregationBits(state, attestation.epoch, attestation)) {
      throw Error("Attestation aggregation bits do not match its committees");
    }
    const indexedAttestation = getIndexedAttestationEip8453(state, attestation);
    if (!isValidIndexedAttestationEip8453(state, indexedAttestation, verifySignature)) {
      throw Error("Invalid indexed attestation");
    }

    const matchesTarget = heightCheckpointEquals(data.target, targetCheckpoint);
    const pendingIndices: number[] = [];
    for (let i = 0; i < pendingCheckpoints.length; i++) {
      if (heightCheckpointEquals(pendingCheckpoints[i], data.finality)) {
        pendingIndices.push(i);
      }
    }

    let proposerRewardNumerator = 0;
    for (const index of indexedAttestation.attestingIndices) {
      const baseReward = effectiveBalanceIncrements[index] * rewardPerIncrement;
      for (const pendingIndex of pendingIndices) {
        const participation = pendingFinality.get(pendingIndex).participation;
        if (!participation.get(index)) {
          participation.set(index, true);
          // ParticipationFlags has setBitwiseOR, so set() is add_flag
          roundParticipation.set(index, 1 << FINALITY_FLAG_INDEX);
          proposerRewardNumerator += baseReward * FINALITY_WEIGHT;
        }
      }
      if (matchesTarget) {
        if (!progressParticipation.get(index)) {
          progressParticipation.set(index, true);
          roundParticipation.set(index, 1 << PROGRESS_FLAG_INDEX);
          proposerRewardNumerator += baseReward * PROGRESS_WEIGHT;
        }
        if (!data.timeout) {
          targetParticipation.set(index, true);
        }
      }
    }
    // The spec floors per attestation
    proposerReward += Math.floor(proposerRewardNumerator / PROPOSER_REWARD_DIVISOR);
  }

  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
  state.proposerRewards.attestations = proposerReward;
}
