import {AttestationData, CommitteeIndex, Slot, Root} from "@chainsafe/lodestar-types";
import {computeStartSlotAtEpoch, getBlockRootAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

export async function assembleAttestationData(
  headState: CachedBeaconState,
  headBlockRoot: Uint8Array,
  slot: Slot,
  index: CommitteeIndex
): Promise<AttestationData> {
  const currentEpoch = headState.currentShuffling.epoch;
  const epochStartSlot = computeStartSlotAtEpoch(headState.config, currentEpoch);

  let epochBoundaryBlockRoot: Root;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = headBlockRoot;
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(headState.config, headState, epochStartSlot);
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
