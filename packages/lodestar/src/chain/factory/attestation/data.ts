import {phase0, CommitteeIndex, Slot, Root, allForks} from "@chainsafe/lodestar-types";
import {
  computeStartSlotAtEpoch,
  getBlockRootAtSlot,
  getCurrentEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";

export function assembleAttestationData(
  headState: allForks.BeaconState,
  headBlockRoot: Uint8Array,
  slot: Slot,
  index: CommitteeIndex
): phase0.AttestationData {
  const currentEpoch = getCurrentEpoch(headState);
  const epochStartSlot = computeStartSlotAtEpoch(currentEpoch);

  let epochBoundaryBlockRoot: Root;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = headBlockRoot;
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(headState, epochStartSlot);
  }

  if (!epochBoundaryBlockRoot) {
    throw new Error(`Missing target block at slot ${epochStartSlot} for attestation`);
  }

  return {
    slot,
    index,
    beaconBlockRoot: headBlockRoot,
    source: headState.currentJustifiedCheckpoint,
    target: {
      epoch: currentEpoch,
      root: epochBoundaryBlockRoot,
    },
  };
}
