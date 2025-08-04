import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkPostDeneb, isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, SignedBeaconBlock, Slot, deneb} from "@lodestar/types";
import {SeenBlockInputCache} from "../../seenCache/seenBlockInput.js";
import {
  BlobsSource as BlobsSourceOld,
  BlockInput as BlockInputOld,
  BlockInputType as BlockInputTypeOld,
  BlockSource as BlockSourceOld,
  CachedData,
  NullBlockInput as NullBlockInputOld,
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

export function convertNewBlockInputToOldBlockInput(config: ChainForkConfig, block: IBlockInput): BlockInputOld {
  const signedBeaconBlock = block.getBlock();
  const blockSource = block.getBlockSource();

  if (isBlockInputPreDeneb(block)) {
    return getBlockInputOld.preData(config, signedBeaconBlock, convertNewToOldBlockSource(blockSource.source));
  }

  if (block.daOutOfRange) {
    return getBlockInputOld.outOfRangeData(config, signedBeaconBlock, convertNewToOldBlockSource(blockSource.source));
  }

  const blobsWithSource = (block as BlockInputBlobs).getAllBlobsWithSource();
  return getBlockInputOld.availableData(config, signedBeaconBlock, convertNewToOldBlockSource(blockSource.source), {
    blobs: blobsWithSource.map(({blobSidecar}) => blobSidecar),
    blobsSource: convertNewToOldBlobSource(blobsWithSource[0].source),
    fork: block.forkName as ForkPostDeneb,
  });
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
  return handleBlockInputOld(cache, old);
}

export function convertOldNullBlockInputToNewBlockInput(
  cache: SeenBlockInputCache,
  old: NullBlockInputOld
): IBlockInput {
  const {blockInputPromise, blockRootHex, cachedData} = old;
  const blockInput = migrateBlobs(cache, Array.from(cachedData.blobsCache.values()), BlobsSourceOld.gossip);

  coordinateAvailabilityPromises(cachedData, blockInput);

  blockInputPromise.then((b) => {
    blockInput.addBlock({
      blockRootHex,
      block: b.block as SignedBeaconBlock<ForkPostDeneb>,
      source: {
        source: convertOldToNewBlockSource(b.source),
        seenTimestampSec: Date.now() / 1000,
      },
    });
  });

  return blockInput;
}

function migrateBlobs(
  cache: SeenBlockInputCache,
  blobs: deneb.BlobSidecars,
  blobsSource: BlobsSourceOld,
  blockInput?: BlockInputBlobs
): BlockInputBlobs {
  for (const blob of blobs) {
    if (blockInput) {
      blockInput.addBlob({
        blockRootHex: blockInput.blockRootHex,
        blobSidecar: blob,
        seenTimestampSec: Date.now() / 1000,
        source: convertOldToNewBlobSource(blobsSource),
      });
    }
    blockInput = cache.getByBlob({
      blobSidecar: blob,
      seenTimestampSec: Date.now() / 1000,
      source: convertOldToNewBlobSource(blobsSource),
    });
  }
  return blockInput as BlockInputBlobs;
}

function coordinateAvailabilityPromises(cachedData: CachedData, blockInput: BlockInputBlobs): void {
  const {availabilityPromise, resolveAvailability} = cachedData;

  availabilityPromise.then(({blobs, blobsSource}) => {
    const missing = blockInput.getMissingBlobMeta();
    for (const {index} of missing) {
      blockInput.addBlob({
        blockRootHex: blockInput.blockRootHex,
        blobSidecar: blobs.find((blobSidecar) => blobSidecar.index === index) as deneb.BlobSidecar,
        seenTimestampSec: Date.now(),
        source: convertOldToNewBlobSource(blobsSource),
      });
    }
  });

  // biome-ignore lint/complexity/useLiteralKeys: protected field
  blockInput["dataPromise"].promise = new Promise((_resolve, _reject) => {
    // biome-ignore lint/complexity/useLiteralKeys: protected field
    blockInput["dataPromise"].resolve = (value) => {
      resolveAvailability({
        blobs: value,
        blobsSource: BlobsSourceOld.gossip,
        fork: ForkName.electra,
      });
      _resolve(value);
    };

    // biome-ignore lint/complexity/useLiteralKeys: protected field
    blockInput["dataPromise"].reject = _reject;

    availabilityPromise.catch((err) => _reject(err));
  });
}

function handleBlockInputOld(cache: SeenBlockInputCache, old: BlockInputOld): IBlockInput {
  let blockInput: IBlockInput | undefined;
  if (old.block) {
    blockInput = cache.getByBlock({
      block: old.block,
      seenTimestampSec: Date.now() / 1000, // this is not correct but BlockInputOld does not track this time,
      source: convertOldToNewBlockSource(old.source),
    });
  }

  if (old.type === BlockInputTypeOld.preData || old.type === BlockInputTypeOld.outOfRangeData) {
    if (!blockInput) {
      throw new Error("Invalid conversion of NullBlockInput to IBlockInput. No block found");
    }
    return blockInput;
  }

  let blobs: deneb.BlobSidecars;
  let blobsSource: BlobsSourceOld;
  if (old.type === BlockInputTypeOld.availableData) {
    const {blobs: availableBlobs, blobsSource: source} = old.blockData;
    blobs = availableBlobs;
    blobsSource = source;
  } else if (old.type === BlockInputTypeOld.dataPromise) {
    const {blobsCache} = old.cachedData;
    blobs = Array.from(blobsCache.values());
    blobsSource = BlobsSourceOld.gossip;
  } else {
    throw new Error(`Invalid conversion of BlockInputOld type=${old.type} to IBlockInput`);
  }

  blockInput = migrateBlobs(cache, blobs, blobsSource, blockInput as BlockInputBlobs | undefined);

  if (old.type === BlockInputTypeOld.dataPromise) {
    coordinateAvailabilityPromises(old.cachedData, blockInput as BlockInputBlobs);
  }

  return blockInput;
}
