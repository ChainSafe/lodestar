import {toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, deneb, fulu, phase0} from "@lodestar/types";
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
  CachedDataColumns,
  DataColumnsSource,
  NullBlockInput,
  getBlockInput,
  getBlockInputBlobs,
  getBlockInputDataColumns,
} from "../../chain/blocks/types.js";
import {ChainEventEmitter} from "../../chain/emitter.js";
import {BlockInputAvailabilitySource} from "../../chain/seenCache/seenGossipBlockInput.js";
import {IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {computeInclusionProof, kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {getDataColumnsFromExecution} from "../../util/dataColumns.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {PartialDownload, matchBlockWithBlobs, matchBlockWithDataColumns} from "./beaconBlocksMaybeBlobsByRange.js";

// keep 1 epoch of stuff, assmume 16 blobs
const MAX_ENGINE_GETBLOBS_CACHE = 32 * 16;
const MAX_UNAVAILABLE_RETRY_CACHE = 32;

export async function beaconBlocksMaybeBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRootRequest,
  partialDownload: null | PartialDownload,
  peerClient: string,
  logger?: Logger
): Promise<{blocks: BlockInput[]; pendingDataColumns: null | number[]}> {
  // console.log("beaconBlocksMaybeBlobsByRoot", request);
  const allBlocks = partialDownload
    ? partialDownload.blocks.map((blockInput) => ({data: blockInput.block}))
    : await network.sendBeaconBlocksByRoot(peerId, request);

  logger?.debug("beaconBlocksMaybeBlobsByRoot response", {allBlocks: allBlocks.length, peerClient});

  const preDataBlocks = [];
  const blobsDataBlocks = [];
  const dataColumnsDataBlocks = [];

  const sampledColumns = network.custodyConfig.sampledColumns;
  const neededColumns = partialDownload ? partialDownload.pendingDataColumns : sampledColumns;
  const peerColumns = network.getConnectedPeerCustody(peerId);

  // get match
  const columns = peerColumns.reduce((acc, elem) => {
    if (neededColumns.includes(elem)) {
      acc.push(elem);
    }
    return acc;
  }, [] as number[]);
  let pendingDataColumns = null;

  const blobIdentifiers: deneb.BlobIdentifier[] = [];
  const dataColumnsByRootIdentifiers: fulu.DataColumnsByRootIdentifier[] = [];

  let prevFork = null;
  for (const block of allBlocks) {
    const slot = block.data.message.slot;
    const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.data.message);
    const fork = config.getForkName(slot);
    if (fork !== (prevFork ?? fork)) {
      throw Error("beaconBlocksMaybeBlobsByRoot only accepts requests of same fork");
    }
    prevFork = fork;

    if (ForkSeq[fork] < ForkSeq.deneb) {
      preDataBlocks.push(block);
    } else if (fork === ForkName.deneb || fork === ForkName.electra) {
      blobsDataBlocks.push(block);
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      logger?.debug("beaconBlocksMaybeBlobsByRoot", {blobKzgCommitmentsLen, peerClient});
      for (let index = 0; index < blobKzgCommitmentsLen; index++) {
        // try see if the blob is available locally
        blobIdentifiers.push({blockRoot, index});
      }
    } else if (fork === ForkName.fulu) {
      dataColumnsDataBlocks.push(block);
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      const custodyColumnIndexes = blobKzgCommitmentsLen > 0 ? columns : [];
      if (custodyColumnIndexes.length > 0) {
        dataColumnsByRootIdentifiers.push({
          blockRoot,
          columns: custodyColumnIndexes,
        });
      }
    } else {
      throw Error(`Invalid fork=${fork} in beaconBlocksMaybeBlobsByRoot`);
    }
  }

  let blockInputs = preDataBlocks.map((block) => getBlockInput.preData(config, block.data, BlockSource.byRoot));

  if (blobsDataBlocks.length > 0) {
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
      allBlocks,
      allBlobSidecars,
      Infinity,
      BlockSource.byRoot,
      BlobsSource.byRoot
    );
    blockInputs = [...blockInputs, ...blockInputWithBlobs];
  }

  if (dataColumnsDataBlocks.length > 0) {
    pendingDataColumns = neededColumns.reduce((acc, elem) => {
      if (!columns.includes(elem)) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    let allDataColumnsSidecars: fulu.DataColumnSidecar[];
    logger?.debug("allDataColumnsSidecars partialDownload", {
      ...(partialDownload
        ? {blocks: partialDownload.blocks.length, pendingDataColumns: partialDownload.pendingDataColumns.join(" ")}
        : {blocks: null, pendingDataColumns: null}),
      dataColumnIdentifiers: dataColumnsByRootIdentifiers
        .map((id) => `${id.blockRoot}: ${id.columns.join(" ")}`)
        .join(" "),
      peerClient,
    });
    if (dataColumnsByRootIdentifiers.length > 0) {
      allDataColumnsSidecars = await network.sendDataColumnSidecarsByRoot(peerId, dataColumnsByRootIdentifiers);
    } else {
      if (partialDownload !== null) {
        return partialDownload;
      }
      allDataColumnsSidecars = [];
    }

    // The last arg is to provide slot to which all blobs should be exausted in matching
    // and here it should be infinity since all bobs should match
    // TODO: should not call matchBlockWithDataColumns() because it's supposed for range sync
    // in that function, peers should return all requested data columns, this function runs at gossip time
    // and it should not expect that
    const blockInputWithBlobs = matchBlockWithDataColumns(
      network,
      peerId,
      config,
      sampledColumns,
      columns,
      allBlocks,
      allDataColumnsSidecars,
      Infinity,
      BlockSource.byRoot,
      DataColumnsSource.byRoot,
      partialDownload,
      peerClient,
      logger
    );
    blockInputs = [...blockInputs, ...blockInputWithBlobs];
  }

  return {
    blocks: blockInputs,
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
    emitter: ChainEventEmitter;
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
    // console.log(
    //   "downloaded sendBeaconBlocksByRoot",
    //   ssz.fulu.SignedBeaconBlock.toJson(block as fulu.SignedBeaconBlock)
    // );
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
      executionEngine: opts.executionEngine,
      emitter: opts.emitter,
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
    executionEngine: IExecutionEngine;
    emitter: ChainEventEmitter;
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
  const slot = block.message.slot;
  const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);

  const blobKzgCommitments = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments;
  if (blobKzgCommitments.length === 0) {
    const blockData = {
      fork: cachedData.fork,
      dataColumns: [],
      dataColumnsBytes: [],
      dataColumnsSource: DataColumnsSource.gossip,
    } as BlockInputDataColumns;

    resolveAvailability(blockData);
    opts.metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
    return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
  }

  const sampledColumns = network.custodyConfig.sampledColumns;
  let neededColumns = sampledColumns.reduce((acc, elem) => {
    if (dataColumnsCache.get(elem) === undefined) {
      acc.push(elem);
    }
    return acc;
  }, [] as number[]);

  let resolveBlockInput: ((block: BlockInput) => void) | null = null;
  const blockInputPromise = new Promise<BlockInput>((resolveCB) => {
    resolveBlockInput = resolveCB;
  });
  if (resolveBlockInput === null) {
    throw Error("Promise Constructor was not executed immediately");
  }

  const gotColumnsFromExecution = await getDataColumnsFromExecution(
    config,
    network.custodyConfig,
    opts.executionEngine,
    opts.emitter,
    {
      fork: config.getForkName(block.message.slot),
      block: block,
      cachedData: cachedData,
      blockInputPromise,
      resolveBlockInput,
    },
    opts.metrics ?? null
  );

  if (!gotColumnsFromExecution) {
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

    let allDataColumnSidecars: fulu.DataColumnSidecar[];
    if (columns.length > 0) {
      allDataColumnSidecars = await network.sendDataColumnSidecarsByRoot(peerId, [{blockRoot, columns}]);
    } else {
      allDataColumnSidecars = [];
    }

    const logCtx = {
      slot: block.message.slot,
      requestedColumns: columns.join(","),
      respondedColumns: allDataColumnSidecars.map((dcs) => dcs.index).join(","),
      peerClient,
    };

    opts.logger?.verbose("unavailableBeaconBlobsByRootPostFulu: Requested data columns from peer", logCtx);

    // the same to matchBlockWithDataColumns() without expecting requested data columns = responded data columns
    // because at gossip time peer may not have enough column to return
    for (const dataColumnSidecar of allDataColumnSidecars) {
      dataColumnsCache.set(dataColumnSidecar.index, {
        dataColumn: dataColumnSidecar,
        // TODO: req/resp should return bytes here
        dataColumnBytes: null,
      });
    }
  }

  // reevaluate needeColumns and resolve availability if possible
  neededColumns = sampledColumns.reduce((acc, elem) => {
    if (dataColumnsCache.get(elem) === undefined) {
      acc.push(elem);
    }
    return acc;
  }, [] as number[]);

  const logCtx = {
    slot: block.message.slot,
    neededColumns: neededColumns.join(","),
    sampledColumns: sampledColumns.join(","),
  };

  if (neededColumns.length === 0) {
    const {dataColumns, dataColumnsBytes} = getBlockInputDataColumns(
      (cachedData as CachedDataColumns).dataColumnsCache,
      sampledColumns
    );

    // don't forget to resolve availability as the block may be stuck in availability wait
    const blockData = {
      fork: config.getForkName(block.message.slot),
      dataColumns,
      dataColumnsBytes,
      dataColumnsSource: DataColumnsSource.byRoot,
    } as BlockInputDataColumns;
    resolveAvailability(blockData);
    opts.logger?.verbose(
      "unavailableBeaconBlobsByRootPostFulu: Resolved availability for block with all data columns",
      logCtx
    );
    return getBlockInput.availableData(config, block, BlockSource.byRoot, blockData);
  }
  opts.logger?.verbose("unavailableBeaconBlobsByRootPostFulu: Still missing data columns for block", logCtx);
  return getBlockInput.dataPromise(config, block, BlockSource.byRoot, cachedData);
}
