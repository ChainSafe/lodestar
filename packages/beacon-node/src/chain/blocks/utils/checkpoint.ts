import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {phase0, ssz} from "@lodestar/types";
import {ZERO_HASH} from "../../../constants/index.js";

/**
 * Compute a Checkpoint type from `state.latestBlockHeader`
 */
export function getCheckpointFromState(checkpointState: CachedBeaconStateAllForks): phase0.Checkpoint {
  const slot = checkpointState.slot;

  if (slot % SLOTS_PER_EPOCH !== 0) {
    throw Error("Checkpoint state slot must be first in an epoch");
  }

  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = checkpointState.hashTreeRoot();
  }

  return {
    root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
    epoch: computeEpochAtSlot(slot),
  };
}
