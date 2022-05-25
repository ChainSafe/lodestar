import {Epoch, phase0, Root, Slot} from "@chainsafe/lodestar-types";
import {byteArrayEquals} from "@chainsafe/ssz";
import {intSqrt} from "@chainsafe/lodestar-utils";

import {getBlockRoot, getBlockRootAtSlot, increaseBalance, verifySignatureSet} from "../../util/index.js";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks} from "../../types.js";
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
import {checkpointToStr, validateAttestation} from "../../phase0/block/processAttestation.js";
import {getAttestationWithIndicesSignatureSet} from "../../allForks/index.js";

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
  const rootCache = new RootCache(state);

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = 0;
  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(state, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const committeeIndices = epochCtx.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = attestation.aggregationBits.intersectValues(committeeIndices);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(state, attestation, attestingIndices);
      if (!verifySignatureSet(sigSet)) {
        throw new Error("Attestation signature is not valid");
      }
    }

    const epochParticipation =
      data.target.epoch === epochCtx.currentShuffling.epoch
        ? state.currentEpochParticipation
        : state.previousEpochParticipation;

    const flagsAttestation = getAttestationParticipationStatus(data, stateSlot - data.slot, epochCtx.epoch, rootCache);

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalanceIncrementsWithWeight = 0;
    for (const index of attestingIndices) {
      const flags = epochParticipation.get(index);

      // For normal block, > 90% of attestations belong to current epoch
      // At epoch boundary, 100% of attestations belong to previous epoch
      // so we want to update the participation flag tree in batch

      // Note ParticipationFlags type uses option {setBitwiseOR: true}, .set() does a |= operation
      epochParticipation.set(index, flagsAttestation);
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
    const proposerRewardNumerator = totalIncrements * state.epochCtx.baseRewardPerIncrement;
    proposerReward += Math.floor(proposerRewardNumerator / PROPOSER_REWARD_DOMINATOR);
  }

  increaseBalance(state, epochCtx.getBeaconProposer(state.slot), proposerReward);
}

/**
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/altair/beacon-chain.md#get_attestation_participation_flag_indices
 */
export function getAttestationParticipationStatus(
  data: phase0.AttestationData,
  inclusionDelay: number,
  currentEpoch: Epoch,
  rootCache: RootCache
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
  const isMatchingHead =
    isMatchingTarget && byteArrayEquals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot));

  let flags = 0;
  if (isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH)) flags |= TIMELY_SOURCE;
  if (isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH) flags |= TIMELY_TARGET;
  if (isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY) flags |= TIMELY_HEAD;

  return flags;
}

export function checkpointValueEquals(cp1: phase0.Checkpoint, cp2: phase0.Checkpoint): boolean {
  return cp1.epoch === cp2.epoch && byteArrayEquals(cp1.root, cp2.root);
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
