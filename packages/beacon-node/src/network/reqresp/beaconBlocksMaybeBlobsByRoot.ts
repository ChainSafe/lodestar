import {fromHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, deneb} from "@lodestar/types";
import {ForkSeq, ForkName} from "@lodestar/params";
import {
  BlockInput,
  BlockInputType,
  BlockSource,
  getBlockInputBlobs,
  getBlockInput,
  NullBlockInput,
} from "../../chain/blocks/types.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {BlockInputAvailabilitySource} from "../../chain/seenCache/seenGossipBlockInput.js";
import {Metrics} from "../../metrics/index.js";
import {matchBlockWithBlobs} from "./beaconBlocksMaybeBlobsByRange.js";

export async function beaconBlocksMaybeBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRootRequest
): Promise<BlockInput[]> {
  const allBlocks = await network.sendBeaconBlocksByRoot(peerId, request);
  const blobIdentifiers: deneb.BlobIdentifier[] = [];

  for (const block of allBlocks) {
    const slot = block.data.message.slot;
    const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.data.message);
    const fork = config.getForkName(slot);

    if (ForkSeq[fork] >= ForkSeq.deneb) {
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      for (let index = 0; index < blobKzgCommitmentsLen; index++) {
        blobIdentifiers.push({blockRoot, index});
      }
    }
  }

  let allBlobSidecars: deneb.BlobSidecar[];
  if (blobIdentifiers.length > 0) {
    allBlobSidecars = await network.sendBlobSidecarsByRoot(peerId, blobIdentifiers);
  } else {
    allBlobSidecars = [];
  }

  // The last arg is to provide slot to which all blobs should be exausted in matching
  // and here it should be infinity since all bobs should match
  return matchBlockWithBlobs(config, allBlocks, allBlobSidecars, Infinity, BlockSource.byRoot);
}

export async function unavailableBeaconBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  unavailableBlockInput: BlockInput | NullBlockInput,
  metrics: Metrics | null
): Promise<BlockInput> {
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.blobsPromise) {
    return unavailableBlockInput as BlockInput;
  }

  // resolve the block if thats unavailable
  let block, blockBytes, cachedData;
  if (unavailableBlockInput.block === null) {
    const allBlocks = await network.sendBeaconBlocksByRoot(peerId, [fromHexString(unavailableBlockInput.blockRootHex)]);
    block = allBlocks[0].data;
    blockBytes = allBlocks[0].bytes;
    cachedData = unavailableBlockInput.cachedData;
  } else {
    ({block, cachedData, blockBytes} = unavailableBlockInput);
    if (cachedData === undefined) {
      throw Error("Missing cachedData for deneb+ unavailable BlockInput");
    }
  }

  // resolve missing blobs
  const {blobsCache} = cachedData;
  const blobIdentifiers: deneb.BlobIdentifier[] = [];
  const slot = block.message.slot;
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);

  const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
  for (let index = 0; index < blobKzgCommitmentsLen; index++) {
    if (blobsCache.has(index) === false) blobIdentifiers.push({blockRoot, index});
  }

  let allBlobSidecars: deneb.BlobSidecar[];
  if (blobIdentifiers.length > 0) {
    allBlobSidecars = await network.sendBlobSidecarsByRoot(peerId, blobIdentifiers);
  } else {
    allBlobSidecars = [];
  }

  // add them in cache so that its reflected in all the blockInputs that carry this
  // for e.g. a blockInput that might be awaiting blobs promise fullfillment in
  // verifyBlocksDataAvailability
  for (const blobSidecar of allBlobSidecars) {
    blobsCache.set(blobSidecar.index, {blobSidecar, blobBytes: null});
  }

  // check and see if all blobs are now available and in that case resolve availability
  // if not this will error and the leftover blobs will be tried from another peer
  const blobsData = getBlockInputBlobs(blobsCache);
  const {blobs, blobsBytes} = blobsData;
  if (blobs.length !== blobKzgCommitmentsLen) {
    throw Error(`Not all blobs fetched missingBlobs=${blobKzgCommitmentsLen - blobs.length}`);
  }

  if (cachedData.fork === ForkName.deneb) {
    const blockData = {fork: cachedData.fork, blobs, blobsBytes};

    cachedData.resolveAvailability(blockData);
    metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
    return getBlockInput.postDeneb(config, block, blockBytes, blockData, BlockSource.byRoot);
  } else {
    throw Error("electra resolution not implemented");
  }
}
