import {ChainForkConfig} from "@lodestar/config";
import {ssz, phase0} from "@lodestar/types";
import {GENESIS_SLOT, ZERO_HASH} from "@lodestar/params";
import {BeaconStateAllForks} from "../types.js";
import {blockToHeader} from "./blockRoot.js";
import {computeCheckpointEpochAtStateSlot} from "./epoch.js";

export function computeAnchorCheckpoint(
  config: ChainForkConfig,
  anchorState: BeaconStateAllForks
): {checkpoint: phase0.Checkpoint; blockHeader: phase0.BeaconBlockHeader} {
  let blockHeader: phase0.BeaconBlockHeader;
  let root: Uint8Array;
  const blockTypes = config.getForkTypes(anchorState.latestBlockHeader.slot);

  if (anchorState.latestBlockHeader.slot === GENESIS_SLOT) {
    const block = blockTypes.BeaconBlock.defaultValue();
    block.stateRoot = anchorState.hashTreeRoot();
    blockHeader = blockToHeader(config, block);
    root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  } else {
    blockHeader = ssz.phase0.BeaconBlockHeader.clone(anchorState.latestBlockHeader);
    if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
      blockHeader.stateRoot = anchorState.hashTreeRoot();
    }
    root = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  }

  return {
    checkpoint: {
      root,
      // the checkpoint epoch = computeEpochAtSlot(anchorState.slot) + 1 if slot is not at epoch boundary
      // this is similar to a process_slots() call
      epoch: computeCheckpointEpochAtStateSlot(anchorState.slot),
    },
    blockHeader,
  };
}
