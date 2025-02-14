import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {Root, RootHex, SignedBeaconBlock, deneb, fulu, phase0, ssz} from "@lodestar/types";
import {BlobAndProof} from "@lodestar/types/deneb";
import {fromHex} from "@lodestar/utils";
import {Logger} from "@lodestar/utils";
import {
  BlobsSource,
  BlockInput,
  BlockInputBlobs,
  BlockInputDataColumns,
  BlockInputType,
  BlockSource,
  CachedBlobs,
  CachedData,
  CachedDataColumns,
  DataColumnsSource,
  NullBlockInput,
  getBlockInput,
  getBlockInputBlobs,
  getBlockInputDataColumns,
} from "../../chain/blocks/types.js";
import {BlockInputAvailabilitySource, getEmptyBlockInputCacheEntry} from "../../chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {computeInclusionProof, kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {PartialDownload, matchBlockWithBlobs, matchBlockWithDataColumns} from "./beaconBlocksMaybeBlobsByRange.js";

// keep 1 epoch of stuff, assmume 16 blobs
const MAX_ENGINE_GETBLOBS_CACHE = 32 * 16;
const MAX_UNAVAILABLE_RETRY_CACHE = 32;

/**
 * Given a block root, fetch all block along with its data (blobs or data columns) from a peer
 * - for deneb and electra, fetch blobs in 1 round
 * - for fulu, fetch data columns in multiple rounds
 *   - round 0: only have the root, partialDownload = null
 *   - round 1 onwards: partialDownload contains the block and pending data columns
 */
export async function beaconBlocksMaybeBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  root: Root,
  partialDownload: null | PartialDownload,
  peerClient: string,
  logger?: Logger
): Promise<{block: BlockInput; pendingDataColumns: null | number[]}> {
  const [block] = partialDownload
    ? partialDownload.blocks.map((blockInput) => ({data: blockInput.block}))
    : await network.sendBeaconBlocksByRoot(peerId, [root]);

  if (partialDownload === null) {
    logger?.debug("beaconBlocksMaybeBlobsByRoot response", {slot: block.data.message.slot, peerClient});
  } else {
    logger?.debug("beaconBlocksMaybeBlobsByRoot partialDownload", {slot: block.data.message.slot, peerClient});
  }

  const {custodyConfig} = network;
  const neededColumns = partialDownload ? partialDownload.pendingDataColumns : custodyConfig.sampledColumns;
  let pendingDataColumns = neededColumns;
  const peerColumns = network.getConnectedPeerCustody(peerId);

  // get match
  const columns = peerColumns.reduce((acc, elem) => {
    if (neededColumns.includes(elem)) {
      acc.push(elem);
    }
    return acc;
  }, [] as number[]);

  const blobIdentifiers: deneb.BlobIdentifier[] = [];
  const dataColumnIdentifiers: fulu.DataColumnIdentifier[] = [];

  const slot = block.data.message.slot;
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.data.message);
  const fork = config.getForkName(slot);

  let blockInput: BlockInput | null = null;
  if (ForkSeq[fork] < ForkSeq.deneb) {
    blockInput = getBlockInput.preData(config, block.data, BlockSource.byRoot)
  } else if (fork === ForkName.deneb || fork === ForkName.electra) {
    // deneb and electra
    const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
    logger?.debug("beaconBlocksMaybeBlobsByRoot", {blobKzgCommitmentsLen, peerClient});
    for (let index = 0; index < blobKzgCommitmentsLen; index++) {
      // try see if the blob is available locally
      blobIdentifiers.push({blockRoot, index});
    }

    let allBlobSidecars: deneb.BlobSidecar[];
    if (blobIdentifiers.length > 0) {
      allBlobSidecars = await network.sendBlobSidecarsByRoot(peerId, blobIdentifiers);
    } else {
      allBlobSidecars = [];
    }

    // The last arg is to provide slot to which all blobs should be exausted in matching
    // and here it should be infinity since all bobs should match
    const blockInputWithBlobs = matchBlockWithBlobs(
      config,
      [block],
      allBlobSidecars,
      Infinity,
      BlockSource.byRoot,
      BlobsSource.byRoot
    );
    if (blockInputWithBlobs.length !== 1) {
      throw Error(`Expected exactly one blockInputWithBlobs slot=${slot}`);
    }
    blockInput = blockInputWithBlobs[0];
  } else if (fork === ForkName.fulu) {
    // fulu
    const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
    logger?.verbose("beaconBlocksMaybeBlobsByRoot", {blobKzgCommitmentsLen, peerClient, requestedColumns: columns.join(",")});

    if (blobKzgCommitmentsLen === 0) {
      // no blobs, return empty data columns
      const blockData = {
        fork: config.getForkName(slot),
        dataColumns: [],
        dataColumnsBytes: [],
        dataColumnsSource: DataColumnsSource.byRoot,
      } as BlockInputDataColumns;

      logger?.debug("beaconBlocksMaybeBlobsByRoot: dataColumnsSidecar empty", {slot, peerClient});
      return {block: getBlockInput.availableData(config, block.data, BlockSource.byRoot, blockData), pendingDataColumns: null};
    }

    for (const columnIndex of columns) {
      dataColumnIdentifiers.push({blockRoot, index: columnIndex});
    }

    let dataColumnSidecars: fulu.DataColumnSidecar[];
    logger?.debug("beaconBlocksMaybeBlobsByRoot: dataColumnsSidecars partialDownload", {
      ...(partialDownload
        ? {blocks: partialDownload.blocks.length, pendingDataColumns: partialDownload.pendingDataColumns.join(" ")}
        : {blocks: null, pendingDataColumns: null}),
      dataColumnIdentifiers: dataColumnIdentifiers.map((did) => did.index).join(" "),
      slot,
      peerClient,
    });
    if (dataColumnIdentifiers.length > 0) {
      dataColumnSidecars = await network.sendDataColumnSidecarsByRoot(peerId, dataColumnIdentifiers);
    } else {
      // peer doesn't have columns we need, return. Consumer should try another peer
      logger?.verbose("beaconBlocksMaybeBlobsByRoot: peer doesn't have columns we need",
        {
          slot,
          peerClient,
          pendingDataColumns: pendingDataColumns.join(","),
          partialDownload: partialDownload !== null,
        });
      if (partialDownload !== null) {
        return {block: partialDownload.blocks[0], pendingDataColumns};
      } else {
        // biome-ignore lint/style/noNonNullAssertion: checked below for validity
        const cachedData = getEmptyBlockInputCacheEntry(config.getForkName(block.data.message.slot), -1).cachedData!;
        if (cachedData === undefined) {
          throw Error("beaconBlocksMaybeBlobsByRoot: Invalid cachedData=undefined from getEmptyBlockInputCacheEntry");
        }
        return {block: getBlockInput.dataPromise(config, block.data, BlockSource.byRoot, cachedData), pendingDataColumns};
      }
    }

    // the same to matchBlockWithDataColumns() without expecting requested data columns = responded data columns
    // because at gossip time peer may not have enough column to return
    let cachedData: CachedData;
    if (partialDownload !== null) {
      const prevBlockInput = partialDownload.blocks[0];
      if (prevBlockInput == null) {
        throw Error("beaconBlocksMaybeBlobsByRoot: prevBlockInput=null in partialDownload");
      }

      if (prevBlockInput.type !== BlockInputType.dataPromise) {
        throw Error(`beaconBlocksMaybeBlobsByRoot: prevBlockInput.type=${prevBlockInput.type} in prevPartialDownload`);
      }
      cachedData = prevBlockInput.cachedData;
    } else {
      // biome-ignore lint/style/noNonNullAssertion: checked below for validity
      cachedData = getEmptyBlockInputCacheEntry(config.getForkName(block.data.message.slot), -1).cachedData!;
      if (cachedData === undefined) {
        throw Error("beaconBlocksMaybeBlobsByRoot: Invalid cachedData=undefined from getEmptyBlockInputCacheEntry");
      }
    }

    if (cachedData.fork !== ForkName.fulu) {
      throw Error("Invalid fork for cachedData on dataColumns");
    }

    const dataColumnsCache = (cachedData as CachedDataColumns).dataColumnsCache;
    for (const dataColumnSidecar of dataColumnSidecars) {
      dataColumnsCache.set(dataColumnSidecar.index, {
        dataColumn: dataColumnSidecar,
        // TODO: req/resp should return bytes here
        dataColumnBytes: null,
      });
    }

    pendingDataColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
      if (dataColumnsCache.get(elem) === undefined) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    const logCtx = {
      slot: slot,
      requestedColumns: columns.join(","),
      respondedColumns: dataColumnSidecars.map((dcs) => dcs.index).join(","),
      pendingDataColumns: pendingDataColumns.join(","),
      peerClient,
    };

    if (pendingDataColumns.length === 0) {
      const {dataColumns, dataColumnsBytes} = getBlockInputDataColumns(
        dataColumnsCache,
        custodyConfig.sampledColumns
      );

      const blockData = {
        fork: config.getForkName(slot),
        dataColumns,
        dataColumnsBytes,
        dataColumnsSource: DataColumnsSource.byRoot,
      } as BlockInputDataColumns;

      logger?.verbose("beaconBlocksMaybeBlobsByRoot: fetched all data columns", logCtx);
      blockInput = getBlockInput.availableData(config, block.data, BlockSource.byRoot, blockData);
    } else {
      // Consumer need to try with another peer
      logger?.verbose("beaconBlocksMaybeBlobsByRoot: still missing data columns for block", logCtx);
      blockInput = getBlockInput.dataPromise(config, block.data, BlockSource.byRoot, cachedData);
    }
  } else {
    throw Error(`Invalid fork=${fork} in beaconBlocksMaybeBlobsByRoot`);
  }

  if (blockInput == null) {
    throw Error("beaconBlocksMaybeBlobsByRoot: blockInput=null");
  }

  return {
    block: blockInput,
    pendingDataColumns: pendingDataColumns && pendingDataColumns.length > 0 ? pendingDataColumns : null,
  };
}

export async function unavailableBeaconBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  peerClient: string,
  unavailableBlockInput: BlockInput | NullBlockInput,
  opts: {
    logger?: Logger;
    metrics?: Metrics | null;
    executionEngine: IExecutionEngine;
    engineGetBlobsCache?: Map<RootHex, BlobAndProof | null>;
    blockInputsRetryTrackerCache?: Set<RootHex>;
  }
): Promise<BlockInput> {
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
    return unavailableBlockInput;
  }

  // resolve the block if thats unavailable
  let block: SignedBeaconBlock, cachedData: NullBlockInput["cachedData"];
  if (unavailableBlockInput.block === null) {
    const allBlocks = await network.sendBeaconBlocksByRoot(peerId, [fromHex(unavailableBlockInput.blockRootHex)]);
    block = allBlocks[0].data;
    cachedData = unavailableBlockInput.cachedData;
    unavailableBlockInput = getBlockInput.dataPromise(config, block, BlockSource.byRoot, cachedData);
  } else {
    ({block, cachedData} = unavailableBlockInput);
  }

  const forkSeq = config.getForkSeq(block.message.slot);

  if (forkSeq < ForkSeq.fulu) {
    return unavailableBeaconBlobsByRootPreFulu(
      config,
      network,
      peerId,
      unavailableBlockInput,
      block,
      cachedData as CachedBlobs,
      opts
    );
  }

  return unavailableBeaconBlobsByRootPostFulu(
    config,
    network,
    peerId,
    peerClient,
    unavailableBlockInput,
    block,
    cachedData,
    {
      metrics: opts.metrics,
      logger: opts.logger,
    }
  );
}

export async function unavailableBeaconBlobsByRootPreFulu(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  unavailableBlockInput: BlockInput | NullBlockInput,
  block: SignedBeaconBlock,
  cachedData: CachedBlobs,
  opts: {
    metrics?: Metrics | null;
    executionEngine: IExecutionEngine;
    engineGetBlobsCache?: Map<RootHex, BlobAndProof | null>;
    blockInputsRetryTrackerCache?: Set<RootHex>;
  }
): Promise<BlockInput> {
  const {executionEngine, metrics, engineGetBlobsCache, blockInputsRetryTrackerCache} = opts;
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
    return unavailableBlockInput;
  }

  // resolve missing blobs
  const slot = block.message.slot;
  const fork = config.getForkName(slot);
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);
  const blockRootHex = toHexString(blockRoot);

  const blockTriedBefore = blockInputsRetryTrackerCache?.has(blockRootHex) === true;
  if (blockTriedBefore) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsReTriedBlobsPull.inc();
  } else {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsTriedBlobsPull.inc();
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
    if (cachedData.blobsCache.has(index) === false) {
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
          cachedData.blobsCache.set(blobSidecar.index, blobSidecar);
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

  if (engineReqIdentifiers.length > 0) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsTriedGetBlobs.inc();
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
      if (cachedData.blobsCache.has(engineReqIdentifiers[j].index) === false) {
        metrics?.blockInputFetchStats.dataPromiseBlobsEngineApiGetBlobsUseful.inc();
        getBlobsUseful = true;
        const {blob, proof: kzgProof} = blobAndProof;
        const {kzgCommitment, index} = engineReqIdentifiers[j];
        const kzgCommitmentInclusionProof = computeInclusionProof(fork, block.message.body, index);
        const blobSidecar = {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
        // add them in cache so that its reflected in all the blockInputs that carry this
        // for e.g. a blockInput that might be awaiting blobs promise fullfillment in
        // verifyBlocksDataAvailability
        cachedData.blobsCache.set(blobSidecar.index, blobSidecar);
      } else {
        metrics?.blockInputFetchStats.dataPromiseBlobsDelayedGossipAvailable.inc();
        metrics?.blockInputFetchStats.dataPromiseBlobsDelayedGossipAvailableSavedGetBlobsCompute.inc();
      }
    }
    // may be blobsidecar arrived in the timespan of making the request
    else {
      metrics?.blockInputFetchStats.dataPromiseBlobsEngineGetBlobsApiNull.inc();
      if (cachedData.blobsCache.has(engineReqIdentifiers[j].index) === false) {
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
    cachedData.blobsCache.set(blobSidecar.index, blobSidecar);
  }

  // check and see if all blobs are now available and in that case resolve availability
  // if not this will error and the leftover blobs will be tried from another peer
  const allBlobs = getBlockInputBlobs(cachedData.blobsCache);
  const {blobs} = allBlobs;
  if (blobs.length !== blobKzgCommitmentsLen) {
    throw Error(`Not all blobs fetched missingBlobs=${blobKzgCommitmentsLen - blobs.length}`);
  }
  const blockData = {fork: cachedData.fork, ...allBlobs, blobsSource: BlobsSource.byRoot} as BlockInputBlobs;
  cachedData.resolveAvailability(blockData);
  metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});

  metrics?.blockInputFetchStats.totalDataPromiseBlockInputsResolvedAvailable.inc();
  if (getBlobsUseful) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsAvailableUsingGetBlobs.inc();
    if (networkReqIdentifiers.length === 0) {
      metrics?.blockInputFetchStats.totalDataPromiseBlockInputsAvailableFromGetBlobs.inc();
    }
  }
  if (networkResBlobSidecars.length > 0) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsFinallyAvailableFromNetworkReqResp.inc();
  }
  if (blockTriedBefore) {
    metrics?.blockInputFetchStats.totalDataPromiseBlockInputsRetriedAvailableFromNetwork.inc();
  }

  return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
}


/**
 * Download more columns for a BlockInput
 * - unavailableBlockInput should have block, but not enough blobs (deneb) or data columns (fulu)
 *
 * This function may return data promise, and consumer should continue with fetching more blobs or columns from other peers
 * see UnknownBlockSync.fetchUnavailableBlockInput()
 */
export async function unavailableBeaconBlobsByRootPostFulu(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  peerClient: string,
  unavailableBlockInput: BlockInput,
  block: SignedBeaconBlock,
  cachedData: NullBlockInput["cachedData"],
  opts: {
    metrics?: Metrics | null;
    logger?: Logger;
  }
): Promise<BlockInput> {
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
    return unavailableBlockInput;
  }

  if (cachedData.fork === ForkName.deneb || cachedData.fork === ForkName.electra) {
    const {blobsCache, resolveAvailability} = cachedData;

    // resolve missing blobs
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
      blobsCache.set(blobSidecar.index, blobSidecar);
    }

    // check and see if all blobs are now available and in that case resolve availability
    // if not this will error and the leftover blobs will be tried from another peer
    const allBlobs = getBlockInputBlobs(blobsCache);
    const {blobs} = allBlobs;
    if (blobs.length !== blobKzgCommitmentsLen) {
      throw Error(`Not all blobs fetched missingBlobs=${blobKzgCommitmentsLen - blobs.length}`);
    }
    const blockData = {fork: cachedData.fork, ...allBlobs, blobsSource: BlobsSource.byRoot} as BlockInputBlobs;
    resolveAvailability(blockData);
    opts.metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
    return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
  }

  // fulu fork
  const {dataColumnsCache, resolveAvailability} = cachedData as CachedDataColumns;

  // resolve missing blobs
  const dataColumnIdentifiers: fulu.DataColumnIdentifier[] = [];
  const slot = block.message.slot;
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);

  const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
  if (blobKzgCommitmentsLen === 0) {
    const blockData = {
      fork: cachedData.fork,
      dataColumns: [],
      dataColumnsBytes: [],
      dataColumnsSource: DataColumnsSource.byRoot,
    } as BlockInputDataColumns;

    resolveAvailability(blockData);
    opts.metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
    return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
  } else {
    const {custodyConfig} = network;
    let neededColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
      if (dataColumnsCache.get(elem) === undefined) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    const peerColumns = network.getConnectedPeerCustody(peerId);

    // get match
    const columns = peerColumns.reduce((acc, elem) => {
      if (neededColumns.includes(elem)) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    // this peer can't help fetching columns for this block
    if (unavailableBlockInput.block !== null && columns.length === 0 && neededColumns.length > 0) {
      return unavailableBlockInput;
    }

    for (const columnIndex of columns) {
      dataColumnIdentifiers.push({blockRoot, index: columnIndex});
    }

    let allDataColumnSidecars: fulu.DataColumnSidecar[];
    if (dataColumnIdentifiers.length > 0) {
      allDataColumnSidecars = await network.sendDataColumnSidecarsByRoot(peerId, dataColumnIdentifiers);
    } else {
      allDataColumnSidecars = [];
    }

    const logCtx = {
      slot: block.message.slot,
      requestedColumns: columns.join(","),
      respondedColumns: allDataColumnSidecars.map((dcs) => dcs.index).join(","),
      peerClient,
    };

    // the same to matchBlockWithDataColumns() without expecting requested data columns = responded data columns
    // because at gossip time peer may not have enough column to return
    for (const dataColumnSidecar of allDataColumnSidecars) {
      dataColumnsCache.set(dataColumnSidecar.index, {
        dataColumn: dataColumnSidecar,
        // TODO: req/resp should return bytes here
        dataColumnBytes: null,
      });
    }

    // reevaluate needeColumns and resolve availability if possible
    neededColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
      if (dataColumnsCache.get(elem) === undefined) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    if (neededColumns.length === 0) {
      const {dataColumns, dataColumnsBytes} = getBlockInputDataColumns(
        (cachedData as CachedDataColumns).dataColumnsCache,
        custodyConfig.sampledColumns
      );

      // don't forget to resolve availability as the block may be stuck in availability wait
      const blockData = {
        fork: config.getForkName(block.message.slot),
        dataColumns,
        dataColumnsBytes,
        dataColumnsSource: DataColumnsSource.byRoot,
      } as BlockInputDataColumns;
      resolveAvailability(blockData);
      opts.logger?.verbose("unavailableBeaconBlobsByRootPostFulu: Resolved availability for block with all data columns", logCtx);
      return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
    } else {
      opts.logger?.verbose("unavailableBeaconBlobsByRootPostFulu: Still missing data columns for block", logCtx);
      return getBlockInput.dataPromise(config, block, BlockSource.byRoot, cachedData);
    }
  }
}
