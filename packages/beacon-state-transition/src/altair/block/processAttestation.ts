import {allForks, altair, Epoch, phase0, Root, Slot, ssz} from "@chainsafe/lodestar-types";
import {intSqrt} from "@chainsafe/lodestar-utils";

import {getBlockRoot, getBlockRootAtSlot, increaseBalance, verifySignatureSet} from "../../util";
import {CachedBeaconState, EpochContext} from "../../allForks/util";
import {CachedEpochParticipation, IParticipationStatus} from "../../allForks/util/cachedEpochParticipation";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  MIN_ATTESTATION_INCLUSION_DELAY,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_WEIGHT,
  TIMELY_SOURCE_WEIGHT,
  TIMELY_TARGET_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {checkpointToStr, validateAttestation} from "../../phase0/block/processAttestation";
import {getAttestationWithIndicesSignatureSet} from "../../allForks";

const PROPOSER_REWARD_DOMINATOR = ((WEIGHT_DENOMINATOR - PROPOSER_WEIGHT) * WEIGHT_DENOMINATOR) / PROPOSER_WEIGHT;

export function processAttestations(
  state: CachedBeaconState<altair.BeaconState>,
  attestations: phase0.Attestation[],
  verifySignature = true
): void {
  const {epochCtx} = state;
  const {effectiveBalances} = epochCtx;
  const stateSlot = state.slot;
  const rootCache = new RootCache(state as CachedBeaconState<allForks.BeaconState>);

  // Process all attestations first and then increase the balance of the proposer once
  let proposerReward = 0;
  const previousEpochStatuses = new Map<number, IParticipationStatus>();
  const currentEpochStatuses = new Map<number, IParticipationStatus>();
  for (const attestation of attestations) {
    const data = attestation.data;

    validateAttestation(state as CachedBeaconState<allForks.BeaconState>, attestation);

    // Retrieve the validator indices from the attestation participation bitfield
    const attestingIndices = epochCtx.getAttestingIndices(data, attestation.aggregationBits);

    // this check is done last because its the most expensive (if signature verification is toggled on)
    // TODO: Why should we verify an indexed attestation that we just created? If it's just for the signature
    // we can verify only that and nothing else.
    if (verifySignature) {
      const sigSet = getAttestationWithIndicesSignatureSet(
        state as CachedBeaconState<allForks.BeaconState>,
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

    const {timelySource, timelyTarget, timelyHead} = getAttestationParticipationStatus(
      data,
      stateSlot - data.slot,
      rootCache,
      epochCtx
    );

    // For each participant, update their participation
    // In epoch processing, this participation info is used to calculate balance updates
    let totalBalancesWithWeight = 0;
    for (const index of attestingIndices) {
      const status = epochStatuses.get(index) || (epochParticipation.getStatus(index) as IParticipationStatus);
      const newStatus = {
        timelySource: status.timelySource || timelySource,
        timelyTarget: status.timelyTarget || timelyTarget,
        timelyHead: status.timelyHead || timelyHead,
      };
      // For normal block, > 90% of attestations belong to current epoch
      // At epoch boundary, 100% of attestations belong to previous epoch
      // so we want to update the participation flag tree in batch
      epochStatuses.set(index, newStatus);
      // epochParticipation.setStatus(index, newStatus);
      /**
       * Spec:
       * baseReward = state.validators[index].effectiveBalance / EFFECTIVE_BALANCE_INCREMENT * baseRewardPerIncrement;
       * proposerRewardNumerator += baseReward * totalWeight
       */
      const tsWeight: number = !status.timelySource && timelySource ? TIMELY_SOURCE_WEIGHT : 0;
      const ttWeight: number = !status.timelyTarget && timelyTarget ? TIMELY_TARGET_WEIGHT : 0;
      const thWeight: number = !status.timelyHead && timelyHead ? TIMELY_HEAD_WEIGHT : 0;
      const totalWeight = tsWeight + ttWeight + thWeight;

      if (totalWeight > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        totalBalancesWithWeight += effectiveBalances.get(index)! * totalWeight;
      }
    }

    // Do the discrete math inside the loop to ensure a deterministic result
    const totalIncrements = Math.floor(totalBalancesWithWeight / EFFECTIVE_BALANCE_INCREMENT);
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
): IParticipationStatus {
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
  return {
    timelySource: isMatchingSource && inclusionDelay <= intSqrt(SLOTS_PER_EPOCH),
    timelyTarget: isMatchingTarget && inclusionDelay <= SLOTS_PER_EPOCH,
    timelyHead: isMatchingHead && inclusionDelay === MIN_ATTESTATION_INCLUSION_DELAY,
  };
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

  constructor(private readonly state: CachedBeaconState<allForks.BeaconState>) {
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
  epochStatuses: Map<number, IParticipationStatus>,
  epochParticipation: CachedEpochParticipation,
  numActiveValidators: number
): void {
  // all active validators are attesters, there are 32 slots per epoch
  // if 1/2 of that or more are updated status, do that in batch, see the benchmark for more details
  if (epochStatuses.size >= numActiveValidators / (2 * SLOTS_PER_EPOCH)) {
    const transientVector = epochParticipation.persistent.asTransient();
    for (const [index, status] of epochStatuses.entries()) {
      transientVector.set(index, status);
    }
    epochParticipation.updateAllStatus(transientVector.vector);
  } else {
    for (const [index, status] of epochStatuses.entries()) {
      epochParticipation.setStatus(index, status);
    }
  }
}
