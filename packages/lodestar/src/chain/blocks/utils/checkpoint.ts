import {CachedBeaconStateAllForks, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../../constants";

/**
 * Compute a Checkpoint type from `state.latestBlockHeader`
 */
export function getCheckpointFromState(checkpointState: CachedBeaconStateAllForks): phase0.Checkpoint {
  const config = checkpointState.config;
  const slot = checkpointState.slot;

  if (slot % SLOTS_PER_EPOCH !== 0) {
    throw Error("Checkpoint state slot must be first in an epoch");
  }

  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.getForkTypes(slot).BeaconState.hashTreeRoot(checkpointState);
  }

  return {
    root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
    epoch: computeEpochAtSlot(slot),
  };
}
