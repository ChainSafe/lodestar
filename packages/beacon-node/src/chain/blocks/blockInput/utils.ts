import {ChainForkConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputPreData,
  DARequirement,
  DAType,
} from "./blockInput.js";

export function isBlockInputPreData(blockInput: BlockInput): blockInput is BlockInputPreData {
  return blockInput.type === DAType.PreData;
}
export function isBlockInputBlobs(blockInput: BlockInput): blockInput is BlockInputBlobs {
  return blockInput.type === DAType.Blobs;
}

export function isBlockInputColumns(blockInput: BlockInput): blockInput is BlockInputColumns {
  return blockInput.type === DAType.Columns;
}

export function getDARequirement(config: ChainForkConfig, blockSlot: Slot, currentEpoch: Epoch): DARequirement {
  if (computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS) {
    return DARequirement.OutOfRange;
  }
  return DARequirement.Required;
}
