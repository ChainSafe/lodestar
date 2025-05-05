import {ChainForkConfig} from "@lodestar/config";
import {isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {BlobsSource, BlockSource} from "../types.js";
import {
  BlockInput,
  BlockInputBlobs,
  // BlockInputColumns,
  BlockInputPreData,
} from "./blockInput.js";
import {BlockInputSource, BlockInputType, DataAvailabilityStatus} from "./types.js";

export function isBlockInputPreDeneb(blockInput: BlockInput): blockInput is BlockInputPreData {
  return blockInput.type === BlockInputType.PreData;
}
export function isBlockInputBlobs(blockInput: BlockInput): blockInput is BlockInputBlobs {
  return blockInput.type === BlockInputType.Blobs;
}

// export function isBlockInputColumns(blockInput: BlockInput): blockInput is BlockInputColumns {
//   return blockInput.type === BlockInputType.Columns;
// }

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

export function convertNewToOldBlockSource(source: BlockInputSource): BlockSource {
  switch (source) {
    case BlockInputSource.api:
      return BlockSource.api;
    case BlockInputSource.byRoot:
      return BlockSource.byRoot;
    case BlockInputSource.byRange:
      return BlockSource.byRange;
    default:
      return BlockSource.gossip;
  }
}

export function convertNewToOldBlobSource(source: BlockInputSource): BlobsSource {
  switch (source) {
    case BlockInputSource.api:
      return BlobsSource.api;
    case BlockInputSource.byRoot:
      return BlobsSource.byRoot;
    case BlockInputSource.byRange:
      return BlobsSource.byRange;
    default:
      return BlobsSource.gossip;
  }
}
