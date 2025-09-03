import {ChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {
  ColumnIndex,
  Epoch,
  SignedBeaconBlock,
  Slot,
  WithOptionalBytes,
  deneb,
  fulu,
  phase0,
  ssz,
} from "@lodestar/types";
import {Logger, prettyPrintIndices} from "@lodestar/utils";
import {
  BlobsSource,
  BlockInput,
  BlockInputBlobs,
  BlockInputDataColumns,
  BlockInputType,
  BlockSource,
  CachedData,
  CachedDataColumns,
  DataColumnsSource,
  getBlockInput,
  getBlockInputDataColumns,
} from "../../chain/blocks/types.js";
import {getEmptyBlockInputCacheEntry} from "../../chain/seenCache/seenGossipBlockInput.js";
import {Metrics} from "../../metrics/index.js";
import {RangeSyncType} from "../../sync/utils/remoteSyncType.js";
import {PeerIdStr} from "../../util/peerId.js";
import {INetwork} from "../interface.js";
import {PeerSyncMeta} from "../peers/peersData.js";
import {PeerAction} from "../peers/score/interface.js";

export type PartialDownload = null | {blocks: BlockInput[]; pendingDataColumns: number[]};
export const SyncSourceByRoot = "ByRoot" as const;
export type SyncSource = RangeSyncType | typeof SyncSourceByRoot;

/**
 * Download blocks and blobs (prefulu) or data columns (fulu) by range.
 * returns:
 *  - array of blocks with blobs or data columns
 *  - pendingDataColumns: null if all data columns are present, or array of column indexes that are missing. Also null for prefulu
 */
export async function beaconBlocksMaybeBlobsByRange(
  config: ChainForkConfig,
  network: INetwork,
  peer: PeerSyncMeta,
  request: phase0.BeaconBlocksByRangeRequest,
  currentEpoch: Epoch,
  partialDownload: PartialDownload,
  syncSource: SyncSource,
  metrics: Metrics | null,
  logger?: Logger
): Promise<{blocks: BlockInput[]; pendingDataColumns: null | number[]}> {
  const {peerId, client: peerClient, custodyGroups: peerColumns, earliestAvailableSlot} = peer;
  // Code below assumes the request is in the same epoch
  // Range sync satisfies this condition, but double check here for sanity
  const {startSlot, count} = request;
  if (count < 1) {
    throw Error(`Invalid count=${count} in BeaconBlocksByRangeRequest`);
  }
  const endSlot = startSlot + count - 1;

  const startEpoch = computeEpochAtSlot(startSlot);
  const endEpoch = computeEpochAtSlot(endSlot);
  if (startEpoch !== endEpoch) {
    throw Error(
      `BeaconBlocksByRangeRequest must be in the same epoch startEpoch=${startEpoch} != endEpoch=${endEpoch}`
    );
  }

  const forkSeq = config.getForkSeq(startSlot);

  // Note: Assumes all blocks in the same epoch
  if (forkSeq < ForkSeq.deneb) {
    const beaconBlocks = await network.sendBeaconBlocksByRange(peerId, request);
    if (beaconBlocks.length === 0) {
      throw Error(
        `peerId=${peerId} peerClient=${peerClient} returned no blocks for BeaconBlocksByRangeRequest ${JSON.stringify(request)}`
      );
    }

    const blocks = beaconBlocks.map((block) => getBlockInput.preData(config, block.data, BlockSource.byRange));
    return {blocks, pendingDataColumns: null};
  }

  // From Deneb
  // Only request blobs if they are recent enough
  if (startEpoch >= currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS) {
    if (forkSeq < ForkSeq.fulu) {
      const [allBlocks, allBlobSidecars] = await Promise.all([
        network.sendBeaconBlocksByRange(peerId, request),
        network.sendBlobSidecarsByRange(peerId, request),
      ]);

      if (allBlocks.length === 0) {
        throw Error(
          `peerId=${peerId} peerClient=${peerClient} returns no blocks allBlobSidecars=${allBlobSidecars.length} for BeaconBlocksByRangeRequest ${JSON.stringify(request)}`
        );
      }

      const blocks = matchBlockWithBlobs(
        config,
        allBlocks,
        allBlobSidecars,
        endSlot,
        BlockSource.byRange,
        BlobsSource.byRange,
        syncSource
      );
      return {blocks, pendingDataColumns: null};
    }

    // From fulu, get columns
    const sampledColumns = network.custodyConfig.sampledColumns;
    const neededColumns = partialDownload ? partialDownload.pendingDataColumns : sampledColumns;

    // This should never throw. Already checking for this in ChainPeerBalancer when selecting the peer
    if ((earliestAvailableSlot ?? 0) > startSlot) {
      throw new Error(
        `earliestAvailableSlot=${earliestAvailableSlot} not respected for ByRange startSlot=${startSlot}`
      );
    }

    // get match
    const columns = peerColumns.reduce((acc, elem) => {
      if (neededColumns.includes(elem)) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    if (columns.length === 0 && partialDownload !== null) {
      // this peer has nothing to offer and should not have been selected for batch download
      // throw error?
      return partialDownload;
    }

    const pendingDataColumns = neededColumns.reduce((acc, elem) => {
      if (!columns.includes(elem)) {
        acc.push(elem);
      }
      return acc;
    }, [] as number[]);

    const dataColumnRequest = {...request, columns};
    const [allBlocks, allDataColumnSidecars] = await Promise.all([
      // TODO-das: investigate why partialDownload blocks is empty here
      partialDownload && partialDownload.blocks.length > 0
        ? partialDownload.blocks.map((blockInput) => ({data: blockInput.block}))
        : network.sendBeaconBlocksByRange(peerId, request),
      columns.length === 0 ? [] : network.sendDataColumnSidecarsByRange(peerId, dataColumnRequest),
    ]);
    logger?.debug("ByRange requests", {
      beaconBlocksRequest: JSON.stringify(ssz.phase0.BeaconBlocksByRangeRequest.toJson(request)),
      dataColumnRequest: JSON.stringify(ssz.fulu.DataColumnSidecarsByRangeRequest.toJson(dataColumnRequest)),
      [`allBlocks(${allBlocks.length})`]: allBlocks.map((blk) => blk.data.message.slot).join(" "),
      [`allDataColumnSidecars(${allDataColumnSidecars.length})`]: allDataColumnSidecars
        .map((dCol) => `${dCol.signedBlockHeader.message.slot}:${dCol.index}`)
        .join(" "),
      peerColumns: prettyPrintIndices(peerColumns),
      peerId,
      peerClient,
      prevPartialDownload: !!partialDownload,
    });

    if (allBlocks.length === 0) {
      throw Error(
        `peerId=${peerId} peerClient=${peerClient} returns no blocks dataColumnSidecars=${allDataColumnSidecars.length} for BeaconBlocksByRangeRequest ${JSON.stringify(request)}`
      );
    }

    const blocks = matchBlockWithDataColumns(
      network,
      peerId,
      config,
      sampledColumns,
      columns,
      allBlocks,
      allDataColumnSidecars,
      endSlot,
      BlockSource.byRange,
      DataColumnsSource.byRange,
      partialDownload,
      peerClient,
      syncSource,
      metrics,
      logger
    );

    return {blocks, pendingDataColumns: pendingDataColumns.length > 0 ? pendingDataColumns : null};
  }

  logger?.verbose(
    `Download range is out of ${config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS} epochs, skip Blobs and DataColumnSidecars download`,
    {
      startEpoch,
      startSlot,
      endSlot,
      currentEpoch,
    }
  );

  // Data is out of range, only request blocks
  const blocks = await network.sendBeaconBlocksByRange(peerId, request);
  if (blocks.length === 0) {
    throw Error(
      `peerId=${peerId} peerClient=${peerClient} returned no blocks for BeaconBlocksByRangeRequest ${JSON.stringify(request)}`
    );
  }
  return {
    blocks: blocks.map((block) => getBlockInput.outOfRangeData(config, block.data, BlockSource.byRange)),
    // null means all data columns are present
    pendingDataColumns: null,
  };
}

// Assumes that the blobs are in the same sequence as blocks, doesn't require block to be sorted
export function matchBlockWithBlobs(
  config: ChainForkConfig,
  allBlocks: WithOptionalBytes<SignedBeaconBlock>[],
  allBlobSidecars: deneb.BlobSidecar[],
  endSlot: Slot,
  blockSource: BlockSource,
  blobsSource: BlobsSource,
  syncSource: SyncSource
): BlockInput[] {
  const blockInputs: BlockInput[] = [];
  let blobSideCarIndex = 0;
  let lastMatchedSlot = -1;

  // Match blobSideCar with the block as some blocks would have no blobs and hence
  // would be omitted from the response. If there are any inconsitencies in the
  // response, the validations during import will reject the block and hence this
  // entire segment.
  //
  // Assuming that the blocks and blobs will come in same sorted order
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];
    if (config.getForkSeq(block.data.message.slot) < ForkSeq.deneb) {
      blockInputs.push(getBlockInput.preData(config, block.data, blockSource));
    } else {
      const blobSidecars: deneb.BlobSidecar[] = [];

      const blockRoot = config.getForkTypes(block.data.message.slot).BeaconBlock.hashTreeRoot(block.data.message);
      const matchBlob = (blobSidecar?: deneb.BlobSidecar): boolean => {
        if (blobSidecar === undefined) {
          return false;
        }

        if (syncSource === RangeSyncType.Head || syncSource === SyncSourceByRoot) {
          return (
            Buffer.compare(
              ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message),
              blockRoot
            ) === 0
          );
        }

        // For finalized range sync, we can just match by slot
        return blobSidecar.signedBlockHeader.message.slot === block.data.message.slot;
      };

      while (matchBlob(allBlobSidecars[blobSideCarIndex])) {
        blobSidecars.push(allBlobSidecars[blobSideCarIndex]);
        lastMatchedSlot = block.data.message.slot;
        blobSideCarIndex++;
      }

      // Quick inspect how many blobSidecars was expected
      const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
      if (blobKzgCommitmentsLen !== blobSidecars.length) {
        throw Error(
          `Missing blobSidecars for blockSlot=${block.data.message.slot} with blobKzgCommitmentsLen=${blobKzgCommitmentsLen} blobSidecars=${blobSidecars.length}`
        );
      }

      const blockData = {
        fork: config.getForkName(block.data.message.slot),
        blobs: blobSidecars,
        blobsSource,
      } as BlockInputBlobs;

      blockInputs.push(getBlockInput.availableData(config, block.data, blockSource, blockData));
    }
  }

  // If there are still unconsumed blobs this means that the response was inconsistent
  // and matching was wrong and hence we should throw error
  if (
    allBlobSidecars[blobSideCarIndex] !== undefined &&
    // If there are no blobs, the blobs request can give 1 block outside the requested range
    allBlobSidecars[blobSideCarIndex].signedBlockHeader.message.slot <= endSlot
  ) {
    throw Error(
      `Unmatched blobSidecars, blocks=${allBlocks.length}, blobs=${
        allBlobSidecars.length
      } lastMatchedSlot=${lastMatchedSlot}, pending blobSidecars slots=${allBlobSidecars
        .slice(blobSideCarIndex)
        .map((blb) => blb.signedBlockHeader.message.slot)
        .join(" ")}`
    );
  }
  return blockInputs;
}

export function matchBlockWithDataColumns(
  network: INetwork,
  peerId: PeerIdStr,
  config: ChainForkConfig,
  sampledColumns: ColumnIndex[],
  requestedColumns: number[],
  allBlocks: WithOptionalBytes<SignedBeaconBlock>[],
  allDataColumnSidecars: fulu.DataColumnSidecar[],
  endSlot: Slot,
  blockSource: BlockSource,
  dataColumnsSource: DataColumnsSource,
  prevPartialDownload: null | PartialDownload,
  peerClient: string,
  syncSource: SyncSource,
  metrics: Metrics | null,
  logger?: Logger
): BlockInput[] {
  const blockInputs: BlockInput[] = [];
  let dataColumnSideCarIndex = 0;
  let lastMatchedSlot = -1;
  const neededColumns = prevPartialDownload?.pendingDataColumns ?? sampledColumns;
  const shouldHaveAllData = neededColumns.reduce((acc, elem) => acc && requestedColumns.includes(elem), true);

  // Match dataColumnSideCar with the block as some blocks would have no dataColumns and hence
  // would be omitted from the response. If there are any inconsitencies in the
  // response, the validations during import will reject the block and hence this
  // entire segment.
  //
  // Assuming that the blocks and blobs will come in same sorted order
  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i];

    const forkSeq = config.getForkSeq(block.data.message.slot);
    if (forkSeq < ForkSeq.fulu) {
      throw Error(`Invalid block forkSeq=${forkSeq} < ForSeq.fulu for matchBlockWithDataColumns`);
    }
    const dataColumnSidecars: fulu.DataColumnSidecar[] = [];
    const blockRoot = config.getForkTypes(block.data.message.slot).BeaconBlock.hashTreeRoot(block.data.message);
    const matchDataColumnSidecar = (dataColumnSidecar?: fulu.DataColumnSidecar): boolean => {
      if (dataColumnSidecar === undefined) {
        return false;
      }

      if (syncSource === RangeSyncType.Head || syncSource === SyncSourceByRoot) {
        return (
          Buffer.compare(
            ssz.phase0.BeaconBlockHeader.hashTreeRoot(dataColumnSidecar.signedBlockHeader.message),
            blockRoot
          ) === 0
        );
      }

      // For finalized range sync, we can just match by slot
      return dataColumnSidecar.signedBlockHeader.message.slot === block.data.message.slot;
    };
    while (matchDataColumnSidecar(allDataColumnSidecars[dataColumnSideCarIndex])) {
      dataColumnSidecars.push(allDataColumnSidecars[dataColumnSideCarIndex]);
      lastMatchedSlot = block.data.message.slot;
      dataColumnSideCarIndex++;
    }
    metrics?.dataColumns.bySource.inc({source: DataColumnsSource.byRange}, dataColumnSidecars.length);

    const blobKzgCommitmentsLen = (block.data.message.body as deneb.BeaconBlockBody).blobKzgCommitments.length;
    logger?.debug("processing matchBlockWithDataColumns", {
      blobKzgCommitmentsLen,
      dataColumnSidecars: dataColumnSidecars.length,
      shouldHaveAllData,
      neededColumns: prettyPrintIndices(neededColumns),
      requestedColumns: prettyPrintIndices(requestedColumns),
      slot: block.data.message.slot,
      dataColumnsSlots: prettyPrintIndices(dataColumnSidecars.map((dcm) => dcm.signedBlockHeader.message.slot)),
      peerClient,
    });
    if (blobKzgCommitmentsLen === 0) {
      if (dataColumnSidecars.length > 0) {
        // only penalize peer with Finalized range sync or "ByRoot" sync source
        if (syncSource !== RangeSyncType.Head) {
          network.reportPeer(peerId, PeerAction.LowToleranceError, "Missing or mismatching dataColumnSidecars");
        }
        throw Error(
          `Missing or mismatching dataColumnSidecars from peerId=${peerId} for blockSlot=${block.data.message.slot} with blobKzgCommitmentsLen=0 dataColumnSidecars=${dataColumnSidecars.length}>0`
        );
      }

      const blockData = {
        fork: config.getForkName(block.data.message.slot),
        dataColumns: [],
        dataColumnsBytes: [],
        dataColumnsSource,
      } as BlockInputDataColumns;
      blockInputs.push(getBlockInput.availableData(config, block.data, blockSource, blockData));
    } else {
      // Quick inspect how many blobSidecars was expected
      const dataColumnIndexes = dataColumnSidecars.map((dataColumnSidecar) => dataColumnSidecar.index);
      const requestedColumnsPresent = requestedColumns.reduce(
        (acc, columnIndex) => acc && dataColumnIndexes.includes(columnIndex),
        true
      );

      logger?.debug("matchBlockWithDataColumns2", {
        dataColumnIndexes: prettyPrintIndices(dataColumnIndexes),
        requestedColumnsPresent,
        slot: block.data.message.slot,
        peerClient,
      });

      if (dataColumnSidecars.length !== requestedColumns.length || !requestedColumnsPresent) {
        logger?.debug(
          `Missing or mismatching dataColumnSidecars from peerId=${peerId} for blockSlot=${block.data.message.slot} with numColumns=${sampledColumns.length} dataColumnSidecars=${dataColumnSidecars.length} requestedColumnsPresent=${requestedColumnsPresent} received dataColumnIndexes=${dataColumnIndexes.join(" ")} requested=${requestedColumns.join(" ")}`,
          {
            allBlocks: allBlocks.length,
            allDataColumnSidecars: allDataColumnSidecars.length,
            peerId,
            blobKzgCommitmentsLen,
            peerClient,
          }
        );
        // only penalize peer with Finalized range sync or "ByRoot" sync source
        if (syncSource !== RangeSyncType.Head) {
          network.reportPeer(peerId, PeerAction.LowToleranceError, "Missing or mismatching dataColumnSidecars");
        }
        throw Error(
          `Missing or mismatching dataColumnSidecars from peerId=${peerId} for blockSlot=${block.data.message.slot} blobKzgCommitmentsLen=${blobKzgCommitmentsLen} with numColumns=${sampledColumns.length} dataColumnSidecars=${dataColumnSidecars.length} requestedColumnsPresent=${requestedColumnsPresent} received dataColumnIndexes=${dataColumnIndexes.join(" ")} requested=${requestedColumns.join(" ")}`
        );
      }

      let cachedData: CachedData;
      // TODO-das: investigate why partialDownload blocks is empty here
      if (prevPartialDownload !== null && prevPartialDownload.blocks.length > 0) {
        const prevBlockInput = prevPartialDownload.blocks[i];
        if (prevBlockInput.type !== BlockInputType.dataPromise) {
          throw Error(`prevBlockInput.type=${prevBlockInput.type} in prevPartialDownload`);
        }
        cachedData = prevBlockInput.cachedData;
      } else {
        // biome-ignore lint/style/noNonNullAssertion: checked below for validity
        cachedData = getEmptyBlockInputCacheEntry(config.getForkName(block.data.message.slot), -1).cachedData!;
        if (cachedData === undefined) {
          throw Error("Invalid cachedData=undefined from getEmptyBlockInputCacheEntry");
        }
      }

      if (cachedData.fork !== ForkName.fulu) {
        throw Error("Invalid fork for cachedData on dataColumns");
      }

      for (const dataColumnSidecar of dataColumnSidecars) {
        (cachedData as CachedDataColumns).dataColumnsCache.set(dataColumnSidecar.index, {
          dataColumn: dataColumnSidecar,
          dataColumnBytes: null,
        });
      }

      if (shouldHaveAllData) {
        const {dataColumns, dataColumnsBytes} = getBlockInputDataColumns(
          (cachedData as CachedDataColumns).dataColumnsCache,
          sampledColumns
        );

        const blockData = {
          fork: config.getForkName(block.data.message.slot),
          dataColumns,
          dataColumnsBytes,
          dataColumnsSource,
        } as BlockInputDataColumns;

        // TODO DENEB: instead of null, pass payload in bytes
        blockInputs.push(getBlockInput.availableData(config, block.data, blockSource, blockData));
      } else {
        blockInputs.push(getBlockInput.dataPromise(config, block.data, blockSource, cachedData));
      }
    }
  }

  // for head sync, there could be unconsumed data column sidecars because the retried peers may have higher head
  if (
    allDataColumnSidecars[dataColumnSideCarIndex] !== undefined &&
    // If there are no data columns, the data columns request can give 1 block outside the requested range
    allDataColumnSidecars[dataColumnSideCarIndex].signedBlockHeader.message.slot <= endSlot &&
    // only penalize peer with Finalized range sync or "ByRoot" sync source
    syncSource !== RangeSyncType.Head
  ) {
    network.reportPeer(peerId, PeerAction.LowToleranceError, "Unmatched dataColumnSidecars");
    throw Error(
      `Unmatched dataColumnSidecars, blocks=${allBlocks.length}, blobs=${
        allDataColumnSidecars.length
      } lastMatchedSlot=${lastMatchedSlot}, pending dataColumnSidecars slots=${allDataColumnSidecars
        .slice(dataColumnSideCarIndex)
        .map((blb) => blb.signedBlockHeader.message.slot)
        .join(" ")} endSlot=${endSlot}, peerId=${peerId}, peerClient=${peerClient}`
    );
  }
  logger?.debug("matched BlockWithDataColumns", {
    peerClient,
    slots: prettyPrintIndices(blockInputs.map((b) => Number(b.block.message.slot))),
    types: blockInputs.map((b) => b.type).join(" "),
  });
  return blockInputs;
}
