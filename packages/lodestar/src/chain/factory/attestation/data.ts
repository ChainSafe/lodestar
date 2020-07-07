import {AttestationData, BeaconBlock, BeaconState, CommitteeIndex, Slot, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db/api";
import {
  computeStartSlotAtEpoch, getBlockRootAtSlot, getCurrentEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";

export async function assembleAttestationData(
  config: IBeaconConfig,
  db: IBeaconDb,
  headState: TreeBacked<BeaconState>,
  headBlock: BeaconBlock,
  slot: Slot,
  index: CommitteeIndex): Promise<AttestationData> {

  const currentEpoch = getCurrentEpoch(config, headState);
  const epochStartSlot = computeStartSlotAtEpoch(config, currentEpoch);

  let epochBoundaryBlockRoot: Root;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = config.types.BeaconBlock.hashTreeRoot(headBlock);
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(config, headState, epochStartSlot);
  }
  if(!epochBoundaryBlockRoot) {
    throw new Error(`Missing target block at slot ${epochStartSlot} for attestation`);
  }

  return {
    slot,
    index,
    beaconBlockRoot: config.types.BeaconBlock.hashTreeRoot(headBlock),
    source: headState.currentJustifiedCheckpoint,
    target: {
      epoch: currentEpoch,
      root: epochBoundaryBlockRoot,
    },
  };
}
