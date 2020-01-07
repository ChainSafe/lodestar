import {signingRoot} from "@chainsafe/ssz";
import {AttestationData, BeaconBlock, BeaconState, CommitteeIndex, Slot, Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IBeaconDb} from "../../../db/api";
import {computeStartSlotAtEpoch, getBlockRootAtSlot, getCurrentEpoch} from "@chainsafe/eth2.0-state-transition";

export async function assembleAttestationData(
  config: IBeaconConfig,
  db: IBeaconDb,
  headState: BeaconState,
  headBlock: BeaconBlock,
  slot: Slot,
  index: CommitteeIndex): Promise<AttestationData> {

  const currentEpoch = getCurrentEpoch(config, headState);
  const epochStartSlot = computeStartSlotAtEpoch(config, currentEpoch);

  let epochBoundaryBlockRoot: Root;
  if (epochStartSlot === headState.slot) {
    epochBoundaryBlockRoot = signingRoot(config.types.BeaconBlock, headBlock);
  } else {
    epochBoundaryBlockRoot = getBlockRootAtSlot(config, headState, epochStartSlot);
  }
  if(!epochBoundaryBlockRoot) {
    throw new Error(`Missing target block at slot ${epochStartSlot} for attestation`);
  }

  return {
    slot,
    index,
    beaconBlockRoot: signingRoot(config.types.BeaconBlock, headBlock),
    source: headState.currentJustifiedCheckpoint,
    target: {
      epoch: currentEpoch,
      root: epochBoundaryBlockRoot,
    },
  };
}
