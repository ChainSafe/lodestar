import {ForkSeq, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, computeEpochAtSlot} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {ZERO_HASH} from "../../../constants/index.js";

/** Compute a checkpoint from an epoch-start state. */
export function getCheckpointFromState(checkpointState: IBeaconStateView): phase0.Checkpoint {
  const slot = checkpointState.slot;

  if (slot % SLOTS_PER_EPOCH !== 0) {
    throw Error("Checkpoint state slot must be first in an epoch");
  }

  if (slot !== GENESIS_SLOT && ForkSeq[checkpointState.forkName] >= ForkSeq.heze) {
    return {
      root: checkpointState.getBlockRootAtSlot(slot - 1),
      epoch: computeEpochAtSlot(slot),
    };
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
