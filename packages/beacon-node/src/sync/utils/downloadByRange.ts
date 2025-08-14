import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, Logger, prettyBytes, prettyPrintIndices} from "@lodestar/utils";
import {BlockInputSource, IBlockInput} from "../../chain/blocks/blockInput/index.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {INetwork, prettyPrintPeerIdStr} from "../../network/index.js";
import {linspace} from "../../util/numpy.js";
import {PeerIdStr} from "../../util/peerId.js";

export type DownloadByRangeRequests = {
  blocksRequest: phase0.BeaconBlocksByRangeRequest;
  blobsRequest?: deneb.BlobSidecarsByRangeRequest;
  columnsRequest?: fulu.DataColumnSidecarsByRangeRequest;
};

export type DownloadByRangeResponses = {
  blocks?: SignedBeaconBlock[];
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export type DownloadAndCacheByRangeProps = DownloadByRangeRequests & {
  config: ChainForkConfig;
  cache: SeenBlockInput;
  network: INetwork;
  logger: Logger;
  peerIdStr: string;
  dataAvailabilityStatus: DataAvailabilityStatus;
};

export type DownloadAndCacheByRangeResults = {
  blockInputs: IBlockInput[];
  numberOfBlocks: number;
  numberOfBlobs: number;
  numberOfColumns: number;
};

export async function downloadAndCacheByRange(
  request: DownloadAndCacheByRangeProps
): Promise<DownloadAndCacheByRangeResults> {
  const {logger, cache, peerIdStr} = request;
  const {blocks, blobSidecars, columnSidecars} = await downloadByRange(request);
  const blockInputs = new Map<RootHex, IBlockInput>();
  const seenTimestampSec = Date.now() / 1000;

  function uncache() {
    for (const [rootHex] of blockInputs) {
      try {
        cache.remove(rootHex);
      } catch (e) {
        logger.error(
          "Error removing blockInput from seenBlockInputCache",
          {blockRoot: prettyBytes(rootHex)},
          e as Error
        );
      }
    }
  }

  let numberOfBlocks = 0;
  if (blocks) {
    try {
      for (const block of blocks) {
        const blockInput = cache.getByBlock({
          block,
          seenTimestampSec,
          source: BlockInputSource.byRange,
          peerIdStr,
        });
        numberOfBlocks++;
        blockInputs.set(blockInput.blockRootHex, blockInput);
      }
    } catch (err) {
      uncache();
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.CACHING_ERROR,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          message: (err as Error).message,
        },
        "Error caching ByRange fetched block"
      );
    }
  }

  const processedBlobs = new Map<RootHex, number[]>();
  let numberOfBlobs = 0;
  if (blobSidecars) {
    try {
      for (const blobSidecar of blobSidecars) {
        const blockInput = cache.getByBlob({
          peerIdStr,
          blobSidecar,
          seenTimestampSec,
          source: BlockInputSource.byRange,
        });
        numberOfBlobs++;
        blockInputs.set(blockInput.blockRootHex, blockInput);
        const indices = processedBlobs.get(blockInput.blockRootHex) ?? [];
        indices.push(blobSidecar.index);
        processedBlobs.set(blockInput.blockRootHex, indices);
      }
    } catch (err) {
      uncache();
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.CACHING_ERROR,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          message: (err as Error).message,
        },
        "Error caching ByRange fetched blob"
      );
    }
  }

  const processedColumns = new Map<RootHex, number[]>();
  let numberOfColumns = 0;
  if (columnSidecars) {
    try {
      for (const columnSidecar of columnSidecars) {
        const blockInput = cache.getByColumn({
          peerIdStr,
          columnSidecar,
          seenTimestampSec,
          source: BlockInputSource.byRange,
        });
        numberOfColumns++;
        blockInputs.set(blockInput.blockRootHex, blockInput);
        const indices = processedColumns.get(blockInput.blockRootHex) ?? [];
        indices.push(columnSidecar.index);
        processedColumns.set(blockInput.blockRootHex, indices);
      }
    } catch (err) {
      uncache();
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.CACHING_ERROR,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          message: (err as Error).message,
        },
        "Error caching ByRange fetched column"
      );
    }
  }

  return {
    blockInputs: Array.from(blockInputs.values()),
    numberOfBlocks,
    numberOfBlobs,
    numberOfColumns,
  };
}

export async function downloadByRange({
  config,
  network,
  logger,
  peerIdStr,
  dataAvailabilityStatus,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: Omit<DownloadAndCacheByRangeProps, "cache">): Promise<DownloadByRangeResponses> {
  const slotRangeString = validateRequests({
    config,
    dataAvailabilityStatus,
    blocksRequest,
    blobsRequest,
    columnsRequest,
  });

  let response: DownloadByRangeResponses;
  try {
    response = await requestByRange({
      network,
      peerIdStr,
      blocksRequest,
      blobsRequest,
      columnsRequest,
    });
  } catch (err) {
    logger.verbose("RangeSync *ByRange error", {}, err as Error);
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR,
      peerId: peerIdStr,
      slotRange: slotRangeString,
    });
  }

  validateResponses({
    peerIdStr,
    slotRangeString,
    blocksRequest,
    blobsRequest,
    columnsRequest,
    ...response,
  });

  return response;
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function validateRequests({
  config,
  dataAvailabilityStatus,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: DownloadByRangeRequests & Pick<DownloadAndCacheByRangeProps, "config" | "dataAvailabilityStatus">): string {
  const startSlot = (blocksRequest?.startSlot ?? blobsRequest?.startSlot ?? columnsRequest?.startSlot) as number;
  const count = (blocksRequest?.count ?? blobsRequest?.count ?? columnsRequest?.count) as number;
  const slotRange = `${startSlot} - ${startSlot + count}`;
  const dataRequest = blobsRequest ?? columnsRequest;

  if (!blocksRequest) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.MISSING_BLOCKS_REQUEST,
      slotRange,
    });
  }

  if (dataAvailabilityStatus !== DataAvailabilityStatus.Available) {
    if (dataRequest) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
          slotRange,
        },
        "Cannot request data if it is not available"
      );
    }

    return slotRange;
  }

  if (!dataRequest) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_DATA_REQUEST,
        slotRange,
      },
      "Must request data if it is available"
    );
  }

  if (blobsRequest && columnsRequest) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
        slotRange,
      },
      "Cannot request both blob and column data in the same slot range"
    );
  }

  const forkName = config.getForkName(startSlot);
  if (!isForkPostDeneb(forkName)) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
        slotRange,
      },
      "Cannot request data pre-deneb"
    );
  }

  if (isForkPostDeneb(forkName) && !isForkPostFulu(forkName) && !blobsRequest) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST,
        slotRange,
      },
      "Must request blobs for blob-only forks"
    );
  }

  if (isForkPostFulu(forkName) && !columnsRequest) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST,
        slotRange,
      },
      "Must request columns for forks with columns"
    );
  }

  if (blocksRequest.startSlot !== dataRequest.startSlot) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.START_SLOT_MISMATCH,
      blockStartSlot: blocksRequest.startSlot,
      dataStartSlot: dataRequest.startSlot,
    });
  }

  if (blocksRequest.count !== dataRequest.count) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.COUNT_MISMATCH,
      blockCount: blocksRequest.count,
      dataCount: dataRequest.count,
    });
  }

  return slotRange;
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export async function requestByRange({
  network,
  peerIdStr,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: DownloadByRangeRequests & {
  network: INetwork;
  peerIdStr: PeerIdStr;
}): Promise<DownloadByRangeResponses> {
  let blocks: undefined | SignedBeaconBlock[];
  let blobSidecars: undefined | deneb.BlobSidecars;
  let columnSidecars: undefined | fulu.DataColumnSidecars;

  const requests: Promise<unknown>[] = [];

  if (blocksRequest) {
    requests.push(
      network.sendBeaconBlocksByRange(peerIdStr, blocksRequest).then((blockResponse) => {
        blocks = blockResponse.map(({data}) => data);
      })
    );
  }

  if (blobsRequest) {
    requests.push(
      network.sendBlobSidecarsByRange(peerIdStr, blobsRequest).then((blobResponse) => {
        blobSidecars = blobResponse;
      })
    );
  }

  if (columnsRequest) {
    requests.push(
      network.sendDataColumnSidecarsByRange(peerIdStr, columnsRequest).then((columnResponse) => {
        columnSidecars = columnResponse;
      })
    );
  }

  await Promise.all(requests);

  return {
    blocks,
    blobSidecars,
    columnSidecars,
  };
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function validateResponses({
  peerIdStr,
  slotRangeString,
  blocksRequest,
  blobsRequest,
  columnsRequest,
  blocks,
  blobSidecars,
  columnSidecars,
}: DownloadByRangeRequests & DownloadByRangeResponses & {peerIdStr: string; slotRangeString: string}): void {
  if (!blocks) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
        slotRange: slotRangeString,
      },
      "No blocks to validate requests against"
    );
  }

  const {missingSlots, extraSlots} = compareBlockByRangeRequestAndResponse(blocksRequest, blocks);
  if (missingSlots) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        missingSlots: prettyPrintIndices(missingSlots),
      },
      "Not all blocks included in BeaconBlocksByRange response"
    );
  }
  if (extraSlots) {
    // extra slots array is allocated when checking requested length against returned array length.  If there are no
    // extras found that means there are duplicates
    if (extraSlots.length === 0) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.DUPLICATE_BLOCKS,
          peerId: prettyPrintPeerIdStr(peerIdStr),
        },
        "Duplicate blocks in BeaconBlocksByRange response"
      );
    }

    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.EXTRA_BLOCKS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        extraSlots: prettyPrintIndices(extraSlots),
      },
      "Extra blocks outside of requested range in BeaconBlocksByRange response"
    );
  }

  if (blobsRequest) {
    if (!blobSidecars) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE,
          slotRange: slotRangeString,
        },
        "No blobSidecars to validate against blobsRequest"
      );
    }
    const {
      expectedBlobCount,
      missingBlobCount,
      missingBlobsDescription,
      extraBlobCount,
      extraBlobsDescription,
      duplicateBlobCount,
      duplicateBlobsDescription,
    } = compareBlobsByRangeRequestAndResponse(blocks, blobSidecars);

    if (duplicateBlobCount > 0) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.DUPLICATE_BLOBS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        expectedBlobCount,
        duplicateBlobCount,
        slotsWithIndices: duplicateBlobsDescription.join(","),
      });
    }

    if (extraBlobCount > 0) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.EXTRA_BLOBS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        expectedBlobCount,
        extraBlobCount,
        slotsWithIndices: extraBlobsDescription.join(","),
      });
    }

    if (missingBlobCount > 0) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_BLOBS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        expectedBlobCount,
        missingBlobCount,
        slotsWithIndices: missingBlobsDescription.join(","),
      });
    }
  }

  if (columnsRequest) {
    if (!columnSidecars) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE,
          slotRange: slotRangeString,
        },
        "No columnSidecars to check columnRequest against"
      );
    }

    const {missingByIndex, extraByIndex} = compareColumnsByRangeRequestAndResponse(columnsRequest, columnSidecars);

    if (extraByIndex.size > 0) {
      const fullExtraColumns: number[] = [];
      let extraColumnCount = 0;
      const partialExtraColumns: string[] = [];
      for (const [index, extraSlots] of extraByIndex) {
        if (extraSlots.length === columnsRequest.count) {
          fullExtraColumns.push(index);
        } else {
          extraColumnCount += extraSlots.length;
          partialExtraColumns.push(`${index}${prettyPrintIndices(extraSlots)}`);
        }
      }

      if (fullExtraColumns.length) {
        // this should be severe peer infraction
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.EXTRA_COLUMNS_ALL_SLOTS,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          extraColumns: prettyPrintIndices(fullExtraColumns),
        });
      }

      // this should be a minor peer infraction? What do you think @twoeths @g11tech?
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.EXTRA_COLUMNS_SOME_SLOTS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        extraColumnCount,
        indicesWithSlots: partialExtraColumns.join(", "),
      });
    }

    if (missingByIndex.size > 0) {
      const missingPeerCustody = [];
      let missingColumnCount = 0;
      const indicesWithSlots = [];
      for (const [index, missingSlots] of missingByIndex) {
        if (missingSlots.length === columnsRequest.count) {
          missingPeerCustody.push(index);
        } else {
          missingColumnCount += missingSlots.length;
          indicesWithSlots.push(`${index}${prettyPrintIndices(missingSlots)}`);
        }
      }

      if (missingPeerCustody.length) {
        // this should be a severe peer infraction
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.PEER_CUSTODY_FAILURE,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          missingColumns: prettyPrintIndices(missingPeerCustody),
        });
      }

      // this should be a minor peer infraction? What do you think @twoeths @g11tech?
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_COLUMNS,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        missingColumnCount,
        indicesWithSlots: indicesWithSlots.join(", "),
      });
    }
  }
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function compareBlockByRangeRequestAndResponse(
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blocks: SignedBeaconBlock[]
): {missingSlots?: number[]; extraSlots?: number[]} {
  const {startSlot, count} = blocksRequest;
  const slotsReceived = blocks.map((block) => block.message.slot);

  const extraSlots: number[] = [];
  if (slotsReceived.length > count) {
    for (const slot of slotsReceived) {
      if (slot < startSlot || slot >= startSlot + count) {
        extraSlots.push(slot);
      }
    }

    return {
      extraSlots,
    };
  }

  const missingSlots: number[] = [];
  for (let slot = startSlot; slot < startSlot + count; slot++) {
    if (!slotsReceived.includes(slot)) {
      missingSlots.push(slot);
    }
  }

  if (missingSlots.length) {
    return {
      missingSlots,
    };
  }

  return {};
}

type BlobComparisonResponse = {
  expectedBlobCount: number;
  missingBlobCount: number;
  extraBlobCount: number;
  duplicateBlobCount: number;
  missingBlobsDescription: string[];
  extraBlobsDescription: string[];
  duplicateBlobsDescription: string[];
};
/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function compareBlobsByRangeRequestAndResponse(
  blocks: SignedBeaconBlock[],
  blobSidecars: deneb.BlobSidecars
): BlobComparisonResponse {
  let expectedBlobCount = 0;
  let missingBlobCount = 0;
  let extraBlobCount = 0;
  let duplicateBlobCount = 0;
  const missingBlobsDescription: string[] = [];
  const extraBlobsDescription: string[] = [];
  const duplicateBlobsDescription: string[] = [];
  for (const block of blocks) {
    const slot = block.message.slot;
    const expectedBlobs = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
    const expectedIndices = linspace(0, expectedBlobs - 1);
    expectedBlobCount += expectedBlobs;
    const receivedBlobs = blobSidecars
      .filter((blobSidecar) => {
        return blobSidecar.signedBlockHeader.message.slot === slot;
      })
      .map((blobSidecar) => blobSidecar.index);

    const missingIndices: number[] = [];
    const duplicateIndices: number[] = [];
    for (const index of expectedIndices) {
      if (!receivedBlobs.includes(index)) {
        missingIndices.push(index);
      }
      if (receivedBlobs.filter((blobIndex) => blobIndex === index).length > 1) {
        duplicateIndices.push(index);
      }
    }
    if (missingIndices.length > 0) {
      missingBlobCount += missingIndices.length;
      missingBlobsDescription.push(`${slot}${prettyPrintIndices(missingIndices)}`);
    }
    if (duplicateIndices.length > 0) {
      duplicateBlobCount += duplicateIndices.length;
      duplicateBlobsDescription.push(`${slot}${prettyPrintIndices(duplicateIndices)}`);
    }

    const extraIndices: number[] = [];
    for (const index of receivedBlobs) {
      if (!expectedIndices.includes(index)) {
        extraIndices.push(index);
      }
    }
    if (extraIndices.length > 0) {
      extraBlobCount += extraIndices.length;
      extraBlobsDescription.push(`${slot}${prettyPrintIndices(extraIndices)}`);
    }
  }

  if (expectedBlobCount !== blobSidecars.length) {
    const expectedSlots = blocks.map((block) => block.message.slot);
    const extraBlocks = new Map<number, number[]>();
    for (const blobSidecar of blobSidecars) {
      const blobSlot = blobSidecar.signedBlockHeader.message.slot;
      if (!expectedSlots.includes(blobSlot)) {
        const extra = extraBlocks.get(blobSlot) ?? [];
        extra.push(blobSidecar.index);
        extraBlocks.set(blobSlot, extra);
        extraBlobCount++;
      }
    }
    if (extraBlocks.size) {
      for (const [slot, extraIndices] of extraBlocks) {
        extraBlobsDescription.push(`${slot}${prettyPrintIndices(extraIndices)}`);
      }
    }
  }

  return {
    expectedBlobCount,
    missingBlobCount,
    extraBlobCount,
    duplicateBlobCount,
    missingBlobsDescription,
    extraBlobsDescription,
    duplicateBlobsDescription,
  };
}

type ColumnComparisonResponse = {
  missingByIndex: Map<number, Slot[]>;
  extraByIndex: Map<number, Slot[]>;
};
/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function compareColumnsByRangeRequestAndResponse(
  columnRequest: fulu.DataColumnSidecarsByRangeRequest,
  columnSidecars: fulu.DataColumnSidecars
): ColumnComparisonResponse {
  const {startSlot, count, columns: expectedColumns} = columnRequest;

  const missingByIndex = new Map<number, Slot[]>();
  const extraByIndex = new Map<number, Slot[]>();

  for (let slot = startSlot; slot < startSlot + count; slot++) {
    const receivedIndices = columnSidecars
      .filter((columnSidecar) => columnSidecar.signedBlockHeader.message.slot === slot)
      .map((columnSidecar) => columnSidecar.index);

    for (const index of receivedIndices) {
      if (!expectedColumns.includes(index)) {
        const extraSlots = extraByIndex.get(index) ?? [];
        extraSlots.push(slot);
        extraByIndex.set(index, extraSlots);
      }
    }

    for (const index of expectedColumns) {
      if (!receivedIndices.includes(index)) {
        const missingSlots = missingByIndex.get(index) ?? [];
        missingSlots.push(slot);
        missingByIndex.set(index, missingSlots);
      }
    }
  }

  return {
    missingByIndex,
    extraByIndex,
  };
}

export enum DownloadByRangeErrorCode {
  MISSING_BLOCKS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS_REQUEST",
  MISSING_BLOCKS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS_RESPONSE",
  MISSING_BLOBS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_REQUEST",
  MISSING_COLUMNS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_REQUEST",
  MISSING_BLOBS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_RESPONSE",
  MISSING_COLUMNS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_RESPONSE",
  INVALID_DATA_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_INVALID_DATA_REQUEST",
  MISSING_DATA_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_DATA_REQUEST",
  START_SLOT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_START_SLOT_MISMATCH",
  COUNT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_COUNT_MISMATCH",
  REQ_RESP_ERROR = "DOWNLOAD_BY_RANGE_ERROR_REQ_RESP_ERROR",
  MISSING_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS",
  EXTRA_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOCKS",
  DUPLICATE_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_DUPLICATE_BLOCKS",
  MISSING_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS",
  EXTRA_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOBS",
  DUPLICATE_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_DUPLICATE_BLOBS",
  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",
  EXTRA_COLUMNS_ALL_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_ALL_SLOTS",
  EXTRA_COLUMNS_SOME_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_SOME_SLOTS",
  PEER_CUSTODY_FAILURE = "DOWNLOAD_BY_RANGE_ERROR_PEER_CUSTODY_FAILURE",
  CACHING_ERROR = "DOWNLOAD_BY_RANGE_CACHING_ERROR",
}

export type DownloadByRangeErrorType =
  | {
      code:
        | DownloadByRangeErrorCode.MISSING_BLOCKS_REQUEST
        | DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST
        | DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST
        | DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE
        | DownloadByRangeErrorCode.INVALID_DATA_REQUEST
        | DownloadByRangeErrorCode.MISSING_DATA_REQUEST;
      slotRange: string;
    }
  | {
      code: DownloadByRangeErrorCode.START_SLOT_MISMATCH;
      blockStartSlot: number;
      dataStartSlot: number;
    }
  | {
      code: DownloadByRangeErrorCode.COUNT_MISMATCH;
      blockCount: number;
      dataCount: number;
    }
  | {
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR;
      peerId: string;
      slotRange: string;
    }
  | {
      code: DownloadByRangeErrorCode.CACHING_ERROR;
      peerId: string;
      message: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_BLOCKS;
      peerId: string;
      missingSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOCKS;
      peerId: string;
      extraSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.DUPLICATE_BLOCKS;
      peerId: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOCKS;
      peerId: string;
      extraSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_BLOBS;
      peerId: string;
      expectedBlobCount: number;
      missingBlobCount: number;
      slotsWithIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOBS;
      peerId: string;
      expectedBlobCount: number;
      extraBlobCount: number;
      slotsWithIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.DUPLICATE_BLOBS;
      peerId: string;
      expectedBlobCount: number;
      duplicateBlobCount: number;
      slotsWithIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_COLUMNS;
      peerId: string;
      missingColumnCount: number;
      indicesWithSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_COLUMNS_ALL_SLOTS;
      peerId: string;
      extraColumns: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_COLUMNS_SOME_SLOTS;
      peerId: string;
      extraColumnCount: number;
      indicesWithSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.PEER_CUSTODY_FAILURE;
      peerId: string;
      missingColumns: string;
    };

export class DownloadByRangeError extends LodestarError<DownloadByRangeErrorType> {}
