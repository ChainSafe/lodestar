import {List} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot, getBlockRoot, getBlockRootAtSlot} from "../../../util";
import {CachedBeaconState} from "../../../fast";
import {isValidIndexedAttestation} from "./isValidIndexedAttestation";
import {MutableVector} from "@chainsafe/persistent-ts";
import {IInclusionData} from "../../../fast/util/cachedInclusionData";
import {CachedEpochParticipation, IParticipationStatus} from "../../../fast/util/cachedEpochParticipation";

export function processAttestation(
  state: CachedBeaconState<phase0.BeaconState>,
  attestation: phase0.Attestation,
  verifySignature = true
): void {
  const {config, epochCtx} = state;
  const {MIN_ATTESTATION_INCLUSION_DELAY, SLOTS_PER_EPOCH} = config.params;
  const slot = state.slot;
  const data = attestation.data;
  const committeeCount = epochCtx.getCommitteeCountAtSlot(data.slot);
  if (!(data.index < committeeCount)) {
    throw new Error(
      "Attestation committee index not within current committee count: " +
        `committeeIndex=${data.index} committeeCount=${committeeCount}`
    );
  }
  if (
    !(data.target.epoch === epochCtx.previousShuffling.epoch || data.target.epoch === epochCtx.currentShuffling.epoch)
  ) {
    throw new Error(
      "Attestation target epoch not in previous or current epoch: " +
        `targetEpoch=${data.target.epoch} currentEpoch=${epochCtx.currentShuffling.epoch}`
    );
  }
  const computedEpoch = computeEpochAtSlot(config, data.slot);
  if (!(data.target.epoch === computedEpoch)) {
    throw new Error(
      "Attestation target epoch does not match epoch computed from slot: " +
        `targetEpoch=${data.target.epoch} computedEpoch=${computedEpoch}`
    );
  }
  if (!(data.slot + MIN_ATTESTATION_INCLUSION_DELAY <= slot && slot <= data.slot + SLOTS_PER_EPOCH)) {
    throw new Error(
      "Attestation slot not within inclusion window: " +
        `slot=${data.slot} window=${data.slot + MIN_ATTESTATION_INCLUSION_DELAY}..${data.slot + SLOTS_PER_EPOCH}`
    );
  }

  const committee = epochCtx.getBeaconCommittee(data.slot, data.index);
  if (attestation.aggregationBits.length !== committee.length) {
    throw new Error(
      "Attestation aggregation bits length does not match committee length: " +
        `aggregationBitsLength=${attestation.aggregationBits.length} committeeLength=${committee.length}`
    );
  }

  // An FFG vote (the source/target) is always for the previous or current epoch checkpoint
  // Downstream logic is relative to the previous or current checkpoint

  // These are part of the state
  let justifiedCheckpoint: phase0.Checkpoint,
    epochAttestations: List<phase0.PendingAttestation>,
    // These are not part of the state, merely additional caches that need updating
    // In altair, epoch participation is included in the consensus state
    epochParticipation: CachedEpochParticipation,
    epochInclusion: MutableVector<IInclusionData>;

  if (data.target.epoch === epochCtx.currentShuffling.epoch) {
    // current
    justifiedCheckpoint = state.currentJustifiedCheckpoint;
    epochAttestations = state.currentEpochAttestations;
    epochParticipation = state.currentEpochParticipation;
    epochInclusion = state.currentInclusionData!;
  } else {
    // previous
    justifiedCheckpoint = state.previousJustifiedCheckpoint;
    epochAttestations = state.previousEpochAttestations;
    epochParticipation = state.previousEpochParticipation;
    epochInclusion = state.previousInclusionData!;
  }

  const isMatchingSource = config.types.phase0.Checkpoint.equals(data.source, justifiedCheckpoint);
  if (!isMatchingSource) {
    throw new Error(
      "Attestation source does not equal justified checkpoint: " +
        `source=${config.types.phase0.Checkpoint.toJson(data.source)} ` +
        `justifiedCheckpoint=${config.types.phase0.Checkpoint.toJson(justifiedCheckpoint)}`
    );
  }

  const indexedAttestation = epochCtx.getIndexedAttestation(attestation);
  if (
    !isValidIndexedAttestation(state as CachedBeaconState<allForks.BeaconState>, indexedAttestation, verifySignature)
  ) {
    throw new Error("Attestation is not valid");
  }

  const inclusionDelay = slot - data.slot;
  const proposerIndex = epochCtx.getBeaconProposer(slot);
  const pendingAttestation = {
    data: data,
    aggregationBits: attestation.aggregationBits,
    inclusionDelay,
    proposerIndex,
  };

  // This doesn't update the state, just state caches
  // It performs the function to altair's up-front participation tracking
  processAttestationParticipation(state, epochParticipation, epochInclusion, pendingAttestation);

  // Add the PendingAttestation to the state
  // During epoch processing, we will rely on our participation cache to update balances, etc. instead of these attestations
  // However, we need to still include them here to maintain consensus (keep the same hashTreeRoot)
  epochAttestations.push(config.types.phase0.PendingAttestation.createTreeBackedFromStruct(pendingAttestation));
}

export function processAttestationParticipation(
  state: CachedBeaconState<phase0.BeaconState>,
  epochParticipation: CachedEpochParticipation,
  epochInclusion: MutableVector<IInclusionData>,
  attestation: phase0.PendingAttestation
): void {
  const {config, epochCtx} = state;
  const data = attestation.data;

  // The source and target votes are part of the FFG vote, the head vote is part of the fork choice vote
  // Both are tracked to properly incentivise validators
  //
  // The source vote always matches the justified checkpoint (else its invalid) (already checked)
  // The target vote should match the most recent checkpoint (eg: the first root of the epoch)
  // The head vote should match the root at the attestation slot (eg: the root at data.slot)
  const isMatchingHead = config.types.Root.equals(data.beaconBlockRoot, getBlockRootAtSlot(config, state, data.slot));
  const isMatchingTarget = config.types.Root.equals(data.target.root, getBlockRoot(config, state, data.target.epoch));

  // Retrieve the validator indices from the attestation participation bitfield
  const attestingIndices = epochCtx.getAttestingIndices(attestation.data, attestation.aggregationBits);

  // For each participant, update their participation and 'inclusion data'
  // In epoch processing, this participation info is used to calculate balance updates

  // In phase0, attestation participation is tracked, but not stored in the state
  // In altair and beyond, attestation participation is marked in the state

  // Inclusion data is whats necessary to calculate inclusion delay rewards at epoch processing time.
  // This is only necessary in phase0
  const inclusionDelay = attestation.inclusionDelay;
  const proposerIndex = attestation.proposerIndex;

  for (const index of attestingIndices) {
    const status = epochParticipation.getStatus(index) as IParticipationStatus;
    const newStatus = {
      // a timely head is only be set if the target is _also_ matching
      timelyHead: status.timelyHead || (isMatchingTarget && isMatchingHead),
      timelySource: true,
      timelyTarget: status.timelyTarget || isMatchingTarget,
    };
    epochParticipation.setStatus(index, newStatus);

    const inclusionData = epochInclusion.get(index) as IInclusionData;
    const isLowerInclusionDelay = !inclusionData.inclusionDelay || inclusionDelay < inclusionData.inclusionDelay;
    if (isLowerInclusionDelay) {
      epochInclusion.set(index, {inclusionDelay, proposerIndex});
    }
  }
}
