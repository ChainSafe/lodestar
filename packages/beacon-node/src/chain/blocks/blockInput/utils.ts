import {ChainForkConfig} from "@lodestar/config";
import {isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {BlockInput, BlockInputBlobs, BlockInputColumns, BlockInputPreData} from "./blockInput.js";
import {BlockInputType, DataAvailabilityStatus} from "./types.js";

export function prettyPrintArray(arr: unknown[]): string {
  return `[ ${arr.join(", ")} ]`;
}

export function isBlockInputPreDeneb(blockInput: BlockInput): blockInput is BlockInputPreData {
  return blockInput.type === BlockInputType.PreData;
}
export function isBlockInputBlobs(blockInput: BlockInput): blockInput is BlockInputBlobs {
  return blockInput.type === BlockInputType.Blobs;
}

export function isBlockInputColumns(blockInput: BlockInput): blockInput is BlockInputColumns {
  return blockInput.type === BlockInputType.Columns;
}

export function getDataAvailabilityStatus(
  config: ChainForkConfig,
  blockSlot: Slot,
  currentEpoch: Epoch
): DataAvailabilityStatus {
  const forkName = config.getForkName(blockSlot);
  if (!isForkPostDeneb(forkName)) {
    return DataAvailabilityStatus.PreData;
  }
  if (computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS) {
    return DataAvailabilityStatus.OutOfRange;
  }
  return DataAvailabilityStatus.Available;
}
