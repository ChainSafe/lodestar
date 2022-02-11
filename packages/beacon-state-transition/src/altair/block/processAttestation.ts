import {Epoch, ParticipationFlags, phase0, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {intSqrt} from "@chainsafe/lodestar-utils";

import {getBlockRoot, getBlockRootAtSlot, increaseBalance, verifySignatureSet} from "../../util";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks, EpochContext} from "../../types";
import {
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_FLAG_INDEX,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {checkpointToStr, validateAttestation} from "../../phase0/block/processAttestation";
import {getAttestationWithIndicesSignatureSet} from "../../allForks";
import {CachedEpochParticipation} from "../../cache/cachedEpochParticipation";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

/** Same to https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#has_flag */
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;
const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;

export function processAttestations(
  state: CachedBeaconStateAltair,
  attestations: phase0.Attestation[],
  verifySignature = true
): void {
  const {epochCtx} = state;
  const {effectiveBalanceIncrements} = epochCtx;
  const stateSlot = state.slot;
  const rootCache = new RootCache(state as CachedBeaconStateAllForks);

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = 0;
  const previousEpochStatuses = new Map<number, ParticipationFlags>();
  const currentEpochStatuses = new Map<number, ParticipationFlags>();
  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(state as CachedBeaconStateAllForks, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const attestingIndices = epochCtx.getAttestingIndices(data, attestation.aggregationBits);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(
        state as CachedBeaconStateAllForks,
        attestation,
        attestingIndices
      );
      if (!verifySignatureSet(sigSet)) {
        throw new Error("Attestation signature is not valid");
      }
    }

    const epochParticipation =
      data.target.epoch === epochCtx.currentShuffling.epoch
        ? state.currentEpochParticipation
        : state.previousEpochParticipation;
    const epochStatuses =
      data.target.epoch === epochCtx.currentShuffling.epoch ? currentEpochStatuses : previousEpochStatuses;

    const flagsAttestation = getAttestationParticipationStatus(data, stateSlot - data.slot, rootCache, epochCtx);

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalanceIncrementsWithWeight = 0;
    for (const index of attestingIndices) {
      const flags = epochStatuses.get(index) ?? (epochParticipation.get(index) as ParticipationFlags);
      // Merge (OR) `flagsAttestation` (new flags) with `flags` (current flags)
      const newFlags = flagsAttestation | flags;

      // For normal block, > 90% of attestations belong to current epoch
      // At epoch boundary, 100% of attestations belong to previous epoch
      // so we want to update the participation flag tree in batch
      epochStatuses.set(index, newFlags);
      // epochParticipation.setStatus(index, newStatus);

      // Returns flags that are NOT set before (~ bitwise NOT) AND are set after
      const flagsNewSet = ~flags & flagsAttestation;

      // Spec:
      // baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
      // proposerRewardNumerator += baseReward * totalWeight
      let totalWeight = 0;
      if ((flagsNewSet & TIMELY_SOURCE) === TIMELY_SOURCE) totalWeight += TIMELY_SOURCE_WEIGHT;
      if ((flagsNewSet & TIMELY_TARGET) === TIMELY_TARGET) totalWeight += TIMELY_TARGET_WEIGHT;
      if ((flagsNewSet & TIMELY_HEAD) === TIMELY_HEAD) totalWeight += TIMELY_HEAD_WEIGHT;

      if (totalWeight > 0) {
        totalBalanceIncrementsWithWeight += effectiveBalanceIncrements[index] * totalWeight;
      }
    }

    // Do the discrete math inside the loop to ensure a deterministic result
    const totalIncrements = totalBalanceIncrementsWithWeight;
    const proposerRewardNumerator = totalIncrements * state.baseRewardPerIncrement;
    proposerReward += Math.floor(proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR);
  }
  updateEpochParticipants(
    previousEpochStatuses,
    state.previousEpochParticipation,
    epochCtx.previousShuffling.activeIndices.length
  );
  updateEpochParticipants(
    currentEpochStatuses,
    state.currentEpochParticipation,
    epochCtx.currentShuffling.activeIndices.length
  );

  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
}

/**
 * https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.4/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
 */
export function getAttestationParticipationStatus(
  data: phase0.AttestationData,
  inclusionDelay: number,
  rootCache: RootCache,
  epochCtx: EpochContext
): ParticipationFlags {
  const justifiedCheckpoint =
    data.target.epoch === epochCtx.currentShuffling.epoch
      ? rootCache.currentJustifiedCheckpoint
      : rootCache.previousJustifiedCheckpoint;

  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingSource = ssz.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      `Attestation source does not equal justified checkpoint: source=${checkpointToStr(
        data.source
      )} justifiedCheckpoint=${checkpointToStr(justifiedCheckpoint)}`
    );
  }

  const isMatchingTarget = ssz.Root.equals(data.target.root, rootCache.getBlockRoot(data.target.epoch));

  // a timely head is only be set if the target is _also_ matching
  const isMatchingHead =
    isMatchingTarget && ssz.Root.equals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot));

  let flags = 0;
  if (isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH)) flags |= TIMELY_SOURCE;
  if (isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH) flags |= TIMELY_TARGET;
  if (isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY) flags |= TIMELY_HEAD;

  return flags;
}

/**
 * Cache to prevent accessing the state tree to fetch block roots repeteadly.
 * In normal network conditions the same root is read multiple times, specially the target.
 */
export class RootCache {
  readonly currentJustifiedCheckpoint: phase0.Checkpoint;
  readonly previousJustifiedCheckpoint: phase0.Checkpoint;
  private readonly blockRootEpochCache = new Map<Epoch, Root>();
  private readonly blockRootSlotCache = new Map<Slot, Root>();

  constructor(private readonly state: CachedBeaconStateAllForks) {
    this.currentJustifiedCheckpoint = state.currentJustifiedCheckpoint;
    this.previousJustifiedCheckpoint = state.previousJustifiedCheckpoint;
  }

  getBlockRoot(epoch: Epoch): Root {
    let root = this.blockRootEpochCache.get(epoch);
    if (!root) {
      root = getBlockRoot(this.state, epoch);
      this.blockRootEpochCache.set(epoch, root);
    }
    return root;
  }

  getBlockRootAtSlot(slot: Slot): Root {
    let root = this.blockRootSlotCache.get(slot);
    if (!root) {
      root = getBlockRootAtSlot(this.state, slot);
      this.blockRootSlotCache.set(slot, root);
    }
    return root;
  }
}

export function updateEpochParticipants(
  epochStatuses: Map<number, ParticipationFlags>,
  epochParticipation: CachedEpochParticipation,
  numActiveValidators: number
): void {
  // all active validators are attesters, there are 32 slots per epoch
  // if 1/2 of that or more are updated flags, do that in batch, see the benchmark for more details
  if (epochStatuses.size >= numActiveValidators / (2 * SLOTS_PER_EPOCH)) {
    const transientVector = epochParticipation.persistent.asTransient();
    for (const [index, flags] of epochStatuses.entries()) {
      transientVector.set(index, flags);
    }
    epochParticipation.updateAllStatus(transientVector.vector);
  } else {
    for (const [index, flags] of epochStatuses.entries()) {
      epochParticipation.set(index, flags);
    }
  }
}
