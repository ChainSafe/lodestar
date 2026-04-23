import {ZERO_HASH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {BeaconStateAllForks} from "../types.js";
import {computeCheckpointEpochAtStateSlot} from "./epoch.js";

export function computeAnchorCheckpoint(anchorState: BeaconStateAllForks): {
  checkpoint: phase0.Checkpoint;
  blockHeader: phase0.BeaconBlockHeader;
} {
  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(anchorState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = anchorState.hashTreeRoot();
  }

  return {
    checkpoint: {
      root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
      // the checkpoint epoch = computeEpochAtSlot(anchorState.slot) + 1 if slot is not at epoch boundary
      // this is similar to a process_slots() call
      epoch: computeCheckpointEpochAtStateSlot(anchorState.slot),
    },
    blockHeader,
  };
}
