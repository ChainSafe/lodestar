import {ChainForkConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {BlobsSource, BlockSource as BlockSourceOld} from "../types.js";
import {BlockInputSource as BlockSource} from "./types.js";

export function isDaOutOfRange(
  config: ChainForkConfig,
  forkName: ForkName,
  blockSlot: Slot,
  currentEpoch: Epoch
): boolean {
  if (!isForkPostDeneb(forkName)) {
    return true;
  }
  return computeEpochAtSlot(blockSlot) < currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS;
}

export function convertNewToOldBlockSource(source: BlockSource): BlockSourceOld {
  switch (source) {
    case BlockSource.api:
      return BlockSourceOld.api;
    case BlockSource.byRoot:
      return BlockSourceOld.byRoot;
    case BlockSource.byRange:
      return BlockSourceOld.byRange;
    default:
      return BlockSourceOld.gossip;
  }
}

export function convertNewToOldBlobSource(source: BlockSource): BlobsSource {
  switch (source) {
    case BlockSource.api:
      return BlobsSource.api;
    case BlockSource.byRoot:
      return BlobsSource.byRoot;
    case BlockSource.byRange:
      return BlobsSource.byRange;
    default:
      return BlobsSource.gossip;
  }
}
