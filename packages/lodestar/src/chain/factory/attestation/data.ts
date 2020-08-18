import {AttestationData, BeaconState, CommitteeIndex, Slot, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  computeStartSlotAtEpoch, getBlockRootAtSlot, getCurrentEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";

export async function assembleAttestationData(
  config: IBeaconConfig,
  headState: TreeBacked<BeaconState>,
  headBlockRoot: Uint8Array,
  slot: Slot,
  index: CommitteeIndex): Promise<AttestationData> {

  const currentEpoch = getCurrentEpoch(config, headState);
  const epochStartSlot = computeStartSlotAtEpoch(config, currentEpoch);

  let epochBoundaryBlockRoot: Root;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = headBlockRoot;
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(config, headState, epochStartSlot);
  }
  if(!epochBoundaryBlockRoot) {
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
