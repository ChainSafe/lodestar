import {fromHexString, toHexString} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {phase0, deneb, peerdas, ssz} from "@lodestar/types";
import {ForkName, ForkSeq, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {Logger} from "@lodestar/utils";
import {
  BlockInput,
  BlockInputType,
  BlockSource,
  getBlockInputBlobs,
  getBlockInput,
  NullBlockInput,
  BlobsSource,
  BlockInputBlobs,
  DataColumnsSource,
  BlockInputDataColumns,
} from "../../chain/blocks/types.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {BlockInputAvailabilitySource} from "../../chain/seenCache/seenGossipBlockInput.js";
import {Metrics} from "../../metrics/index.js";
import {PartialDownload, matchBlockWithBlobs, matchBlockWithDataColumns} from "./beaconBlocksMaybeBlobsByRange.js";

export async function beaconBlocksMaybeBlobsByRoot(
  config: ChainForkConfig,
  network: INetwork,
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRootRequest,
  partialDownload: null | PartialDownload,
  peerClient: string,
  logger?: Logger
): Promise<{blocks: BlockInput[]; pendingDataColumns: null | number[]}> {
  console.log("beaconBlocksMaybeBlobsByRoot", request);
  const allBlocks = partialDownload
    ? partialDownload.blocks.map((blockInput) => ({data: blockInput.block, bytes: blockInput.blockBytes!}))
    : await network.sendBeaconBlocksByRoot(peerId, request);

  logger?.debug("beaconBlocksMaybeBlobsByRoot response", {allBlocks: allBlocks.length, peerClient});

  const preDataBlocks = [];
  const blobsDataBlocks = [];
  const dataColumnsDataBlocks = [];

  const {custodyConfig} = network;
  const neededColumns = partialDownload ? partialDownload.pendingDataColumns : custodyConfig.sampledColumns;
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
  const dataColumnIdentifiers: peerdas.DataColumnIdentifier[] = [];

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
    } else if (fork === ForkName.deneb) {
      blobsDataBlocks.push(block);
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      logger?.debug("beaconBlocksMaybeBlobsByRoot", {blobKzgCommitmentsLen, peerClient});
      for (let index = 0; index < blobKzgCommitmentsLen; index++) {
        blobIdentifiers.push({blockRoot, index});
      }
    } else if (fork === ForkName.peerdas) {
      dataColumnsDataBlocks.push(block);
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      const custodyColumnIndexes = blobKzgCommitmentsLen > 0 ? columns : [];
      for (const columnIndex of custodyColumnIndexes) {
        dataColumnIdentifiers.push({blockRoot, index: columnIndex});
      }
    } else {
      throw Error(`Invalid fork=${fork} in beaconBlocksMaybeBlobsByRoot`);
    }
  }

  let blockInputs = preDataBlocks.map((block) =>
    getBlockInput.preData(config, block.data, BlockSource.byRoot, block.bytes)
  );

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

    let allDataColumnsSidecars: peerdas.DataColumnSidecar[];
    logger?.debug("allDataColumnsSidecars partialDownload", {
      ...(partialDownload
        ? {blocks: partialDownload.blocks.length, pendingDataColumns: partialDownload.pendingDataColumns.join(" ")}
        : {blocks: null, pendingDataColumns: null}),
      dataColumnIdentifiers: dataColumnIdentifiers.map((did) => did.index).join(" "),
      peerClient,
    });
    if (dataColumnIdentifiers.length > 0) {
      allDataColumnsSidecars = await network.sendDataColumnSidecarsByRoot(peerId, dataColumnIdentifiers);
    } else {
      if (partialDownload !== null) {
        return partialDownload;
      }
      allDataColumnsSidecars = [];
    }

    // The last arg is to provide slot to which all blobs should be exausted in matching
    // and here it should be infinity since all bobs should match
    const blockInputWithBlobs = matchBlockWithDataColumns(
      network,
      peerId,
      config,
      custodyConfig,
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
  unavailableBlockInput: BlockInput | NullBlockInput,
  metrics: Metrics | null,
  peerClient: string,
  logger?: Logger
): Promise<BlockInput> {
  if (unavailableBlockInput.block !== null && unavailableBlockInput.type !== BlockInputType.dataPromise) {
    return unavailableBlockInput;
  }

  // resolve the block if thats unavailable
  let block, blockBytes, cachedData;
  if (unavailableBlockInput.block === null) {
    const allBlocks = await network.sendBeaconBlocksByRoot(peerId, [fromHexString(unavailableBlockInput.blockRootHex)]);
    block = allBlocks[0].data;
    blockBytes = allBlocks[0].bytes;
    cachedData = unavailableBlockInput.cachedData;
    unavailableBlockInput = getBlockInput.dataPromise(config, block, BlockSource.byRoot, blockBytes, cachedData);
    console.log(
      "downloaded sendBeaconBlocksByRoot",
      ssz.peerdas.SignedBeaconBlock.toJson(block as peerdas.SignedBeaconBlock)
    );
  } else {
    ({block, cachedData, blockBytes} = unavailableBlockInput);
  }

  let availableBlockInput;
  if (cachedData.fork === ForkName.deneb) {
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
      blobsCache.set(blobSidecar.index, {blobSidecar, blobBytes: null});
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
    metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
    availableBlockInput = getBlockInput.availableData(config, block, BlockSource.byRoot, blockBytes, blockData);
  } else if (cachedData.fork === ForkName.peerdas) {
    const {dataColumnsCache, resolveAvailability, cacheId} = cachedData;

    // resolve missing blobs
    const dataColumnIdentifiers: peerdas.DataColumnIdentifier[] = [];
    const slot = block.message.slot;
    const blockRoot = config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block.message);

    const blobKzgCommitmentsLen = (block.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
    if (blobKzgCommitmentsLen === 0) {
      const blockData = {
        fork: cachedData.fork,
        dataColumns: [],
        dataColumnsBytes: [],
        dataColumnsSource: DataColumnsSource.gossip,
      } as BlockInputDataColumns;

      resolveAvailability(blockData);
      metrics?.syncUnknownBlock.resolveAvailabilitySource.inc({source: BlockInputAvailabilitySource.UNKNOWN_SYNC});
      availableBlockInput = getBlockInput.availableData(config, block, BlockSource.byRoot, blockBytes, blockData);
    } else {
      const {custodyConfig} = network;
      const neededColumns = custodyConfig.sampledColumns.reduce((acc, elem) => {
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

      console.log("unavailableBlockInput fetching", {
        neededColumns: neededColumns.length,
        peerColumns: peerColumns.length,
        intersectingColumns: columns.length,
        dataColumnIdentifiers: dataColumnIdentifiers.length,
        cacheId,
        dataColumnsCache: dataColumnsCache.size,
        blockRoot: toHexString(blockRoot),
      });

      let allDataColumnSidecars: peerdas.DataColumnSidecar[];
      if (dataColumnIdentifiers.length > 0) {
        allDataColumnSidecars = await network.sendDataColumnSidecarsByRoot(peerId, dataColumnIdentifiers);
      } else {
        allDataColumnSidecars = [];
      }

      console.log("unavailableBlockInput fetched", {
        neededColumns: neededColumns.length,
        peerColumns: peerColumns.length,
        intersectingColumns: columns.length,
        dataColumnIdentifiers: dataColumnIdentifiers.length,
        allDataColumnSidecars: allDataColumnSidecars.length,
        cacheId,
        dataColumnsCache: dataColumnsCache.size,
        blockRoot: toHexString(blockRoot),
      });

      [availableBlockInput] = matchBlockWithDataColumns(
        network,
        peerId,
        config,
        custodyConfig,
        columns,
        [{data: block, bytes: blockBytes}],
        allDataColumnSidecars,
        block.message.slot,
        BlockSource.byRoot,
        DataColumnsSource.byRoot,
        unavailableBlockInput.block !== null
          ? {blocks: [unavailableBlockInput], pendingDataColumns: neededColumns}
          : null,
        peerClient,
        logger
      );

      // don't forget to resolve availability as the block may be stuck in availability wait
      if (availableBlockInput !== undefined && availableBlockInput.type === BlockInputType.availableData) {
        const {blockData} = availableBlockInput;
        if (blockData.fork !== ForkName.peerdas) {
          throw Error(`unexpected blockData fork=${blockData.fork} returned by matchBlockWithDataColumns`);
        }
        resolveAvailability(blockData);
      }
    }
  } else {
    throw Error(`Invalid cachedData fork=${cachedData.fork} for unavailableBeaconBlobsByRoot`);
  }

  return availableBlockInput;
}
