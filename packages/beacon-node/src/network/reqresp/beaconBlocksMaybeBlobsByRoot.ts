import {toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, deneb, phase0} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {fromHex} from "@lodestar/utils";
import {
  BlobsSource,
  BlockInput,
  BlockInputDataBlobs,
  BlockInputType,
  BlockSource,
  NullBlockInput,
  getBlockInput,
  getBlockInputBlobs,
} from "../../chain/blocks/types.js";
import {BlockInputAvailabilitySource} from "../../chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {computeInclusionProof, kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {matchBlockWithBlobs} from "./beaconBlocksMaybeBlobsByRange.js";

// keep 1 epoch of stuff, assmume 16 blobs
const MAX_ENGINE_GETBLOBS_CACHE = 32 * 16;
const MAX_UNAVAILABLE_RETRY_CACHE = 32;

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
        // try see if the blob is available locally
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
  return matchBlockWithBlobs(config, allBlocks, allBlobSidecars, Infinity, BlockSource.byRoot, BlobsSource.byRoot);
}

export async function unavailableBeaconBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  unavailableBlockInput: BlockInput | NullBlockInput,
  opts: {
    metrics: Metrics | null;
    executionEngine: IExecutionEngine;
    engineGetBlobsCache?: Map<RootHex, BlobAndProof | null>;
    blockInputsRetryTrackerCache?: Set<RootHex>;
  }
): Promise<BlockInput> {
  const {executionEngine, metrics, engineGetBlobsCache, blockInputsRetryTrackerCache} = opts;
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
    return unavailableBlockInput;
  }

  // resolve the block if thats unavailable
  let block: SignedBeaconBlock,
    blobsCache: NullBlockInput["cachedData"]["blobsCache"],
    blockBytes: Uint8Array | null,
    resolveAvailability: NullBlockInput["cachedData"]["resolveAvailability"],
    cachedData: NullBlockInput["cachedData"];
  if (unavailableBlockInput.block === null) {
    const allBlocks = await network.sendBeaconBlocksByRoot(peerId, [fromHex(unavailableBlockInput.blockRootHex)]);
    block = allBlocks[0].data;
    blockBytes = allBlocks[0].bytes;
    cachedData = unavailableBlockInput.cachedData;
    ({blobsCache, resolveAvailability} = cachedData);
  } else {
    ({block, cachedData, blockBytes} = unavailableBlockInput);
    ({blobsCache, resolveAvailability} = cachedData);
  }

  // resolve missing blobs
  const slot = block.message.slot;
  const fork = config.getForkName(slot);
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toHexString(blockRoot);

  const blockTriedBefore = blockInputsRetryTrackerCache?.has(blockRootHex) === true;
  if (blockTriedBefore) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsReTried.inc();
  } else {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsTried.inc();
    blockInputsRetryTrackerCache?.add(blockRootHex);
  }

  const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
  const signedBlockHeader = signedBlockToSignedHeader(config, block);

  const engineReqIdentifiers: (deneb.BlobIdentifier & {
    kzgCommitment: deneb.KZGCommitment;
    versionedHash: Uint8Array;
  })[] = [];
  const networkReqIdentifiers: deneb.BlobIdentifier[] = [];

  let getBlobsUseful = false;
  for (let index = 0; index < blobKzgCommitmentsLen; index++) {
    if (blobsCache.has(index) === false) {
      const kzgCommitment = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments[index];
      const versionedHash = kzgCommitmentToVersionedHash(kzgCommitment);

      // check if the getblobs cache has the data if block not been queried before
      if (engineGetBlobsCache?.has(toHexString(versionedHash)) === true && !blockTriedBefore) {
        const catchedBlobAndProof = engineGetBlobsCache.get(toHexString(versionedHash)) ?? null;
        if (catchedBlobAndProof === null) {
          metrics?.blockInputFetchStats.dataPromiseBlobsFoundInGetBlobsCacheNull.inc();
          networkReqIdentifiers.push({blockRoot, index});
        } else {
          metrics?.blockInputFetchStats.dataPromiseBlobsFoundInGetBlobsCacheNotNull.inc();
          // compute TODO: also add inclusion proof cache
          const {blob, proof: kzgProof} = catchedBlobAndProof;
          const kzgCommitmentInclusionProof = computeInclusionProof(fork, block.message.body, index);
          const blobSidecar = {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
          blobsCache.set(blobSidecar.index, {blobSidecar, blobBytes: null});
        }
      } else if (blockTriedBefore) {
        // only retry it from network
        networkReqIdentifiers.push({blockRoot, index});
      } else {
        // see if we can pull from EL
        metrics?.blockInputFetchStats.dataPromiseBlobsNotAvailableInGetBlobsCache.inc();
        engineReqIdentifiers.push({blockRoot, index, versionedHash, kzgCommitment});
      }
    } else {
      metrics?.blockInputFetchStats.dataPromiseBlobsAlreadyAvailable.inc();
    }
  }

  const versionedHashes = engineReqIdentifiers.map((bi) => bi.versionedHash);
  metrics?.blockInputFetchStats.dataPromiseBlobsEngineGetBlobsApiRequests.inc(versionedHashes.length);

  const blobAndProofs = await executionEngine.getBlobs(ForkName.deneb, versionedHashes).catch((_e) => {
    metrics?.blockInputFetchStats.dataPromiseBlobsEngineApiGetBlobsErroredNull.inc(versionedHashes.length);
    return versionedHashes.map((_vh) => null);
  });

  for (let j = 0; j < versionedHashes.length; j++) {
    const blobAndProof = blobAndProofs[j] ?? null;
    // save to cache for future reference
    engineGetBlobsCache?.set(toHexString(versionedHashes[j]), blobAndProof);
    if (blobAndProof !== null) {
      metrics?.blockInputFetchStats.dataPromiseBlobsEngineGetBlobsApiNotNull.inc();

      // if we already got it by now, save the compute
      if (blobsCache.has(engineReqIdentifiers[j].index) === false) {
        metrics?.blockInputFetchStats.dataPromiseBlobsEngineApiGetBlobsUseful.inc();
        getBlobsUseful = true;
        const {blob, proof: kzgProof} = blobAndProof;
        const {kzgCommitment, index} = engineReqIdentifiers[j];
        const kzgCommitmentInclusionProof = computeInclusionProof(fork, block.message.body, index);
        const blobSidecar = {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
        // add them in cache so that its reflected in all the blockInputs that carry this
        // for e.g. a blockInput that might be awaiting blobs promise fullfillment in
        // verifyBlocksDataAvailability
        blobsCache.set(blobSidecar.index, {blobSidecar, blobBytes: null});
      } else {
        metrics?.blockInputFetchStats.dataPromiseBlobsDelayedGossipAvailable.inc();
        metrics?.blockInputFetchStats.dataPromiseBlobsDeplayedGossipAvailableSavedGetBlobsCompute.inc();
      }
    }
    // may be blobsidecar arrived in the timespan of making the request
    else {
      metrics?.blockInputFetchStats.dataPromiseBlobsEngineGetBlobsApiNull.inc();
      if (blobsCache.has(engineReqIdentifiers[j].index) === false) {
        const {blockRoot, index} = engineReqIdentifiers[j];
        networkReqIdentifiers.push({blockRoot, index});
      } else {
        metrics?.blockInputFetchStats.dataPromiseBlobsDelayedGossipAvailable.inc();
      }
    }
  }

  if (engineGetBlobsCache !== undefined) {
    // prune out engineGetBlobsCache
    let pruneLength = Math.max(0, engineGetBlobsCache?.size - MAX_ENGINE_GETBLOBS_CACHE);
    for (const key of engineGetBlobsCache.keys()) {
      if (pruneLength <= 0) break;
      engineGetBlobsCache.delete(key);
      pruneLength--;
      metrics?.blockInputFetchStats.getBlobsCachePruned.inc();
    }
    metrics?.blockInputFetchStats.getBlobsCacheSize.set(engineGetBlobsCache.size);
  }
  if (blockInputsRetryTrackerCache !== undefined) {
    // prune out engineGetBlobsCache
    let pruneLength = Math.max(0, blockInputsRetryTrackerCache?.size - MAX_UNAVAILABLE_RETRY_CACHE);
    for (const key of blockInputsRetryTrackerCache.keys()) {
      if (pruneLength <= 0) break;
      blockInputsRetryTrackerCache.delete(key);
      pruneLength--;
      metrics?.blockInputFetchStats.dataPromiseBlockInputRetryTrackerCachePruned.inc();
    }
    metrics?.blockInputFetchStats.dataPromiseBlockInputRetryTrackerCacheSize.set(blockInputsRetryTrackerCache.size);
  }

  // if clients expect sorted identifiers
  networkReqIdentifiers.sort((a, b) => a.index - b.index);
  let networkResBlobSidecars: deneb.BlobSidecar[];
  metrics?.blockInputFetchStats.dataPromiseBlobsFinallyQueriedFromNetwork.inc(networkReqIdentifiers.length);
  if (blockTriedBefore) {
    metrics?.blockInputFetchStats.dataPromiseBlobsRetriedFromNetwork.inc(networkReqIdentifiers.length);
  }

  if (networkReqIdentifiers.length > 0) {
    networkResBlobSidecars = await network.sendBlobSidecarsByRoot(peerId, networkReqIdentifiers);
    metrics?.blockInputFetchStats.dataPromiseBlobsFinallyAvailableFromNetwork.inc(networkResBlobSidecars.length);
    if (blockTriedBefore) {
      metrics?.blockInputFetchStats.dataPromiseBlobsRetriedAvailableFromNetwork.inc(networkResBlobSidecars.length);
    }
  } else {
    networkResBlobSidecars = [];
  }

  // add them in cache so that its reflected in all the blockInputs that carry this
  // for e.g. a blockInput that might be awaiting blobs promise fullfillment in
  // verifyBlocksDataAvailability
  for (const blobSidecar of networkResBlobSidecars) {
    blobsCache.set(blobSidecar.index, {blobSidecar, blobBytes: null});
  }

  // check and see if all blobs are now available and in that case resolve availability
  // if not this will error and the leftover blobs will be tried from another peer
  const allBlobs = getBlockInputBlobs(blobsCache);
  const {blobs} = allBlobs;
  if (blobs.length !== blobKzgCommitmentsLen) {
    throw Error(`Not all blobs fetched missingBlobs=${blobKzgCommitmentsLen - blobs.length}`);
  }
  const blockData = {fork: cachedData.fork, ...allBlobs, blobsSource: BlobsSource.byRoot} as BlockInputDataBlobs;
  resolveAvailability(blockData);
  metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});

  metrics?.blockInputFetchStats.totalDataAvailableBlockInputs.inc();
  if (getBlobsUseful) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsAvailableUsingGetBlobs.inc();
  }
  if (blockTriedBefore) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsRetriedAvailableFromNetwork.inc();
  }

  return getBlockInput.availableData(config, block, BlockSource.byRoot, blockBytes, blockData);
}
