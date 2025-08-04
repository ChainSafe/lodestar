import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostDeneb, isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Slot} from "@lodestar/types";
import {SeenBlockInputCache} from "../../seenCache/seenBlockInput.js";
import {
  BlobsSource as BlobsSourceOld,
  BlockInput as BlockInputOld,
  BlockInputType as BlockInputTypeOld,
  BlockSource as BlockSourceOld,
  getBlockInput as getBlockInputOld,
} from "../types.js";
import {BlockInputBlobs, isBlockInputPreDeneb} from "./blockInput.js";
import {BlockInputSource, IBlockInput} from "./types.js";

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

export function convertNewToOldBlockSource(source: BlockInputSource): BlockSourceOld {
  switch (source) {
    case BlockInputSource.api:
      return BlockSourceOld.api;
    case BlockInputSource.byRoot:
      return BlockSourceOld.byRoot;
    case BlockInputSource.byRange:
      return BlockSourceOld.byRange;
    default:
      return BlockSourceOld.gossip;
  }
}

export function convertOldToNewBlockSource(source: BlockSourceOld): BlockInputSource {
  switch (source) {
    case BlockSourceOld.api:
      return BlockInputSource.api;
    case BlockSourceOld.byRoot:
      return BlockInputSource.byRoot;
    case BlockSourceOld.byRange:
      return BlockInputSource.byRange;
    default:
      return BlockInputSource.gossip;
  }
}

export function convertNewToOldBlobSource(source: BlockInputSource): BlobsSourceOld {
  switch (source) {
    case BlockInputSource.api:
      return BlobsSourceOld.api;
    case BlockInputSource.byRoot:
      return BlobsSourceOld.byRoot;
    case BlockInputSource.byRange:
      return BlobsSourceOld.byRange;
    default:
      return BlobsSourceOld.gossip;
  }
}

export function convertOldToNewBlobSource(source: BlobsSourceOld): BlockInputSource {
  switch (source) {
    case BlobsSourceOld.api:
      return BlockInputSource.api;
    case BlobsSourceOld.byRoot:
      return BlockInputSource.byRoot;
    case BlobsSourceOld.byRange:
      return BlockInputSource.byRange;
    default:
      return BlockInputSource.gossip;
  }
}

export function convertOldBlockInputToNewBlockInput(cache: SeenBlockInputCache, old: BlockInputOld): IBlockInput {
  const {block, source, type} = old;
  const blockInput = cache.getByBlock({
    block,
    seenTimestampSec: Date.now(), // this is not correct but BlockInputOld does not track this time,
    source: convertNewToOldBlockSource(source),
  });
  if (type === BlockInputTypeOld.preData || type === BlockInputTypeOld.outOfRangeData) {
    return blockInput;
  }
  if (type === BlockInputTypeOld.availableData) {
    const {blobs, blobsSource} = old.blockData;
    for (const blob of blobs) {
      (blockInput as BlockInputBlobs).addBlob({
        blockRootHex: blockInput.blockRootHex,
        blobSidecar: blob,
        seenTimestampSec: Date.now(),
        source: convertOldToNewBlobSource(blobsSource),
      });
    }
    return blockInput;
  }
  if (type === BlockInputTypeOld.dataPromise) {
    const {blobsCache, availabilityPromise, resolveAvailability} = old.cachedData;
    for (const blob of blobsCache) {
      (blockInput as BlockInputBlobs).addBlob({
        blockRootHex: blockInput.blockRootHex,
        blobSidecar: blob,
        seenTimestampSec: Date.now(),
        source: BlockInputSource.gossip, // this is not correct but BlockInputOld does not track this
      });
    }

    availabilityPromise.then(({blobs, blobsSource}) => {
      const missing = (blockInput as BlockInputBlobs).getMissingBlobMeta();
      for (const {index} of missing) {
        (blockInput as BlockInputBlobs).addBlob({
          blockRootHex: blockInput.blockRootHex,
          blobSidecar: blobs[index],
          seenTimestampSec: Date.now(),
          source: convertOldToNewBlobSource(blobsSource),
        });
      }
    });

    // biome-ignore lint/complexity/useLiteralKeys: protected field
    (blockInput as BlockInputBlobs)["dataPromise"].promise = new Promise((_resolve, _reject) => {
      // biome-ignore lint/complexity/useLiteralKeys: protected field
      (blockInput as BlockInputBlobs)["dataPromise"].resolve = (value) => {
        resolveAvailability({
          blobs: value,
          blobsSource: BlobsSourceOld.gossip,
          fork: ForkName.electra,
        });
        _resolve(value);
      };

      // biome-ignore lint/complexity/useLiteralKeys: protected field
      (blockInput as BlockInputBlobs)["dataPromise"].reject = _reject;

      availabilityPromise.catch((err) => _reject(err));
    });
  }
}

export function convertNewBlockInputToOldBlockInput(block: IBlockInput): BlockInputOld {
  const signedBeaconBlock = block.blockInput.getBlock();
  const blockSource = block.blockInput.getBlockSource();

  if (isBlockInputPreDeneb(block.blockInput)) {
    return getBlockInputOld.preData(this.config, signedBeaconBlock, convertNewToOldBlockSource(blockSource.source));
  }

  if (block.blockInput.daOutOfRange) {
    return getBlockInputOld.outOfRangeData(
      this.config,
      signedBeaconBlock,
      convertNewToOldBlockSource(blockSource.source)
    );
  }

  const blobsWithSource = (block.blockInput as BlockInputBlobs).getAllBlobsWithSource();
  return getBlockInputOld.availableData(
    this.config,
    signedBeaconBlock,
    convertNewToOldBlockSource(blockSource.source),
    {
      blobs: blobsWithSource.map(({blobSidecar}) => blobSidecar),
      blobsSource: convertNewToOldBlobSource(blobsWithSource[0].source),
      fork: block.blockInput.forkName as ForkPostDeneb,
    }
  );
}
