import {byteArrayEquals} from "@chainsafe/ssz";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  ForkSeq,
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {Attestation, Epoch, phase0} from "@lodestar/types";
import {intSqrt} from "@lodestar/utils";
import {BeaconStateTransitionMetrics} from "../metrics.js";
import {getAttestationWithIndicesSignatureSet} from "../signatureSets/indexedAttestation.js";
import {CachedBeaconStateAltair, CachedBeaconStateGloas} from "../types.js";
import {isAttestationSameSlot, isAttestationSameSlotRootCache} from "../util/gloas.ts";
import {increaseBalance, verifySignatureSet} from "../util/index.js";
import {RootCache} from "../util/rootCache.js";
import {checkpointToStr, isTimelyTarget, validateAttestation} from "./processAttestationPhase0.js";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const SLOTS_PER_EPOCH_SQRT = intSqrt(SLOTS_PER_EPOCH);

export function processAttestationsAltair(
  fork: ForkSeq,
  state: CachedBeaconStateAltair | CachedBeaconStateGloas,
  attestations: Attestation[],
  verifySignature = true,
  metrics?: BeaconStateTransitionMetrics | null
): void {
  const {epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const stateSlot = state.slot;
  const rootCache = new RootCache(state);
  const currentEpoch = epochCtx.epoch;

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = 0;
  let newSeenAttesters = 0;
  let newSeenAttestersEffectiveBalance = 0;

  const builderWeightMap: Map<number, number> = new Map();

  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(fork, state, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const attestingIndices = epochCtx.getAttestingIndices(fork, attestation);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(state.config, state.slot, attestation, attestingIndices);
      if (!verifySignatureSet(sigSet, state.epochCtx.index2pubkey)) {
        throw new Error("Attestation signature is not valid");
      }
    }

    const inCurrentEpoch = data.target.epoch === currentEpoch;
    const epochParticipation = inCurrentEpoch ? state.currentEpochParticipation : state.previousEpochParticipation;
    // Count how much additional weight added to current or previous epoch's builder pending payment (in ETH increment)
    let paymentWeightToAdd = 0;

    const flagsAttestation = getAttestationParticipationStatus(
      fork,
      data,
      stateSlot - data.slot,
      epochCtx.epoch,
      rootCache,
      fork >= ForkSeq.gloas ? (state as CachedBeaconStateGloas).executionPayloadAvailability.toBoolArray() : null
    );

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalanceIncrementsWithWeight = 0;
    const validators = state.validators;
    for (const validatorIndex of attestingIndices) {
      const flags = epochParticipation.get(validatorIndex);

      // For normal block, > 90% of attestations belong to current epoch
      // At epoch boundary, 100% of attestations belong to previous epoch
      // so we want to update the participation flag tree in batch

      // Note ParticipationFlags type uses option {setBitwiseOR: true}, .set() does a |= operation
      epochParticipation.set(validatorIndex, flagsAttestation);
      // epochParticipation.setStatus(index, newStatus);

      // Returns flags that are NOT set before (~ bitwise NOT) AND are set after
      const flagsNewSet = ~flags & flagsAttestation;
      if (flagsNewSet !== 0) {
        newSeenAttesters++;
        newSeenAttestersEffectiveBalance += effectiveBalanceIncrements[validatorIndex];
      }

      // Spec:
      // baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
      // proposerRewardNumerator += baseReward * totalWeight
      let totalWeight = 0;
      if ((flagsNewSet & TIMELY_SOURCE) === TIMELY_SOURCE) totalWeight += TIMELY_SOURCE_WEIGHT;
      if ((flagsNewSet & TIMELY_TARGET) === TIMELY_TARGET) totalWeight += TIMELY_TARGET_WEIGHT;
      if ((flagsNewSet & TIMELY_HEAD) === TIMELY_HEAD) totalWeight += TIMELY_HEAD_WEIGHT;

      if (totalWeight > 0) {
        totalBalanceIncrementsWithWeight += effectiveBalanceIncrements[validatorIndex] * totalWeight;
      }

      // TODO: describe issue. Compute progressive target balances
      // When processing each attestation, increase the cummulative target balance. Only applies post-altair
      if ((flagsNewSet & TIMELY_TARGET) === TIMELY_TARGET) {
        const validator = validators.getReadonly(validatorIndex);
        if (!validator.slashed) {
          if (inCurrentEpoch) {
            epochCtx.currentTargetUnslashedBalanceIncrements += effectiveBalanceIncrements[validatorIndex];
          } else {
            epochCtx.previousTargetUnslashedBalanceIncrements += effectiveBalanceIncrements[validatorIndex];
          }
        }
      }

      if (fork >= ForkSeq.gloas && flagsNewSet !== 0 && isAttestationSameSlot(state as CachedBeaconStateGloas, data)) {
        paymentWeightToAdd += effectiveBalanceIncrements[validatorIndex];
      }
    }

    // Do the discrete math inside the loop to ensure a deterministic result
    const totalIncrements = totalBalanceIncrementsWithWeight;
    const proposerRewardNumerator = totalIncrements * state.epochCtx.baseRewardPerIncrement;
    proposerReward += Math.floor(proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR);

    if (fork >= ForkSeq.gloas) {
      const builderPendingPaymentIndex = inCurrentEpoch
        ? SLOTS_PER_EPOCH + (data.slot % SLOTS_PER_EPOCH)
        : data.slot % SLOTS_PER_EPOCH;

      const existingWeight =
        builderWeightMap.get(builderPendingPaymentIndex) ??
        (state as CachedBeaconStateGloas).builderPendingPayments.get(builderPendingPaymentIndex).weight;
      const updatedWeight = existingWeight + paymentWeightToAdd * EFFECTIVE_BALANCE_INCREMENT;
      builderWeightMap.set(builderPendingPaymentIndex, updatedWeight);
    }
  }

  for (const [index, weight] of builderWeightMap) {
    const payment = (state as CachedBeaconStateGloas).builderPendingPayments.get(index);
    if (payment.withdrawal.amount > 0) {
      payment.weight = weight;
    }
  }

  metrics?.newSeenAttestersPerBlock.set(newSeenAttesters);
  metrics?.newSeenAttestersEffectiveBalancePerBlock.set(newSeenAttestersEffectiveBalance);
  metrics?.attestationsPerBlock.set(attestations.length);

  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
  state.proposerRewards.attestations = proposerReward;
}

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
 */
export function getAttestationParticipationStatus(
  fork: ForkSeq,
  data: phase0.AttestationData,
  inclusionDelay: number,
  currentEpoch: Epoch,
  rootCache: RootCache,
  executionPayloadAvailability: boolean[] | null
): number {
  const justifiedCheckpoint =
    data.target.epoch === currentEpoch ? rootCache.currentJustifiedCheckpoint : rootCache.previousJustifiedCheckpoint;

  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingSource = checkpointValueEquals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      `Attestation source does not equal justified checkpoint: source=${checkpointToStr(
        data.source
      )} justifiedCheckpoint=${checkpointToStr(justifiedCheckpoint)}`
    );
  }

  const isMatchingTarget = byteArrayEquals(data.target.root, rootCache.getBlockRoot(data.target.epoch));

  // a timely head is only be set if the target is _also_ matching
  // In gloas, this is called `head_root_matches`
  let isMatchingHead =
    isMatchingTarget && byteArrayEquals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot));

  if (fork >= ForkSeq.gloas) {
    let isMatchingPayload = false;

    if (isAttestationSameSlotRootCache(rootCache, data)) {
      if (data.index !== 0) {
        throw new Error("Attesting same slot must indicate empty payload");
      }
      isMatchingPayload = true;
    } else {
      if (executionPayloadAvailability === null) {
        throw new Error("Must supply executionPayloadAvailability post-gloas");
      }

      if (data.index !== 0 && data.index !== 1) {
        throw new Error(`data index must be 0 or 1 index=${data.index}`);
      }

      isMatchingPayload = Boolean(data.index) === executionPayloadAvailability[data.slot % SLOTS_PER_HISTORICAL_ROOT];
    }

    isMatchingHead = isMatchingHead && isMatchingPayload;
  }

  let flags = 0;
  if (isMatchingSource && inclusionDelay <= SLOTS_PER_EPOCH_SQRT) flags |= TIMELY_SOURCE;
  if (isMatchingTarget && isTimelyTarget(fork, inclusionDelay)) flags |= TIMELY_TARGET;
  if (isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY) flags |= TIMELY_HEAD;

  return flags;
}

export function checkpointValueEquals(cp1: phase0.Checkpoint, cp2: phase0.Checkpoint): boolean {
  return cp1.epoch === cp2.epoch && byteArrayEquals(cp1.root, cp2.root);
}
