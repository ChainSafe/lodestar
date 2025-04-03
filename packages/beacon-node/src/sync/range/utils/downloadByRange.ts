import assert from "node:assert";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputByRootRequests,
  BlockInputError,
  BlockInputErrorType,
  BlockInputSourceType,
  BlockInputType,
  MissingBlob,
  MissingData,
} from "../../../chain/blocks/utils/blockInput.js";
import {BlockInputCache} from "../../../chain/blocks/utils/blockInputCache.js";
import {IBeaconChain} from "../../../chain/interface.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {Batch} from "../batch.js";
import {
  ForkName,
  ForkPostDeneb,
  isForkBlobs,
  isForkPostDeneb,
  isForkPostFulu,
  MAX_REQUEST_BLOCKS,
  MAX_REQUEST_DATA_COLUMN_SIDECARS,
} from "@lodestar/params";
import {INetwork, prettyPrintPeerIdStr} from "../../../network/index.js";
import {linspace} from "../../../util/numpy.js";
import {ColumnIndex, deneb, Epoch, fulu, phase0, RootHex, SignedBeaconBlock, Slot, WithBytes} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {LodestarError} from "@lodestar/utils";
import {BlobSidecar} from "@lodestar/types/lib/deneb/types.js";

export function prettyPrintArray(arr: unknown[]): string {
  return `[ ${arr.join(",")} ]`;
}

export type DownloadByRangeRequests = {
  blocksRequest?: phase0.BeaconBlocksByRangeRequest;
  blobsRequest?: deneb.BlobSidecarsByRangeRequest;
  columnsRequest?: fulu.DataColumnSidecarsByRangeRequest;
};

type DownloadByRangeResponses = {
  blocks?: WithBytes<SignedBeaconBlock>[];
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export type DownloadAndCacheByRangeProps = DownloadByRangeRequests & {
  network: INetwork;
  chain: IBeaconChain;
  config: ChainForkConfig;
  peerIdStr: string;
  dataAvailabilityStatus: DataAvailabilityStatus;
};

export type DownloadAndCacheByRangeResults = {
  blockInputs: BlockInput[];
  numberOfBlocks: number;
  numberOfBlobs: number;
  numberOfColumns: number;
};

export async function downloadAndCacheByRange(
  request: DownloadAndCacheByRangeProps
): Promise<DownloadAndCacheByRangeResults> {
  const {chain, dataAvailabilityStatus, peerIdStr} = request;
  const {blocks, blobSidecars, columnSidecars} = await downloadByRange(request);
  const blockInputs = new Map<RootHex, BlockInput>();
  const seenTimestampSec = Date.now() / 1000;
  const cache = chain.blockInputCache;

  function uncacheBlocks() {
    for (const blockInput of blockInputs.values()) {
      try {
        cache.removeBlockFromBlockInput(blockInput.rootHex);
      } catch (e) {
        chain.logger.error("Cannot remove block from BlockInput", blockInput.getLogMeta(), e as Error);
      }
    }
  }

  function uncacheBlobs(processed: Map<RootHex, number[]>) {
    for (const [rootHex, indices] of processed.entries()) {
      try {
        cache.removeBlobsFromBlockInput(rootHex, indices);
      } catch (e) {
        chain.logger.error(`Cannot remove blobs from BlockInput rootHex=${rootHex} indices=${indices}`, {}, e as Error);
      }
    }
  }

  function uncacheColumns(processed: Map<RootHex, number[]>) {
    for (const [rootHex, indices] of processed.entries()) {
      try {
        cache.removeColumnsFromBlockInput(rootHex, indices);
      } catch (e) {
        chain.logger.error(
          `Cannot remove columns from BlockInput rootHex=${rootHex} indices=${indices}`,
          {},
          e as Error
        );
      }
    }
  }

  let numberOfBlocks = 0;
  if (blocks) {
    try {
      for (const block of blocks) {
        const blockInput = cache.getBlockInputByBlock({
          peerIdStr,
          seenTimestampSec,
          block: block.data,
          source: BlockInputSourceType.byRange,
          dataAvailability: dataAvailabilityStatus,
        });
        numberOfBlocks++;
        blockInputs.set(blockInput.rootHex, blockInput);
      }
    } catch (err) {
      chain.logger.verbose(
        "Error caching ByRange fetched block",
        {peerId: prettyPrintPeerIdStr(peerIdStr)},
        err as Error
      );
      uncacheBlocks();
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.CACHING_ERROR,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        message: (err as Error).message,
      });
    }
  }

  const processedBlobs = new Map<RootHex, number[]>();
  let numberOfBlobs = 0;
  if (blobSidecars) {
    try {
      for (const blobSidecar of blobSidecars) {
        const blockInput = cache.getBlockInputByBlob({
          peerIdStr,
          blobSidecar,
          seenTimestampSec,
          source: BlockInputSourceType.byRange,
        });
        numberOfBlobs++;
        blockInputs.set(blockInput.rootHex, blockInput);
        const indices = processedBlobs.get(blockInput.rootHex) ?? [];
        indices.push(blobSidecar.index);
        processedBlobs.set(blockInput.rootHex, indices);
      }
    } catch (err) {
      chain.logger.verbose(
        "Error caching ByRange fetched blob",
        {peerId: prettyPrintPeerIdStr(peerIdStr)},
        err as Error
      );
      uncacheBlobs(processedBlobs);
      if (numberOfBlocks !== 0) {
        uncacheBlocks();
      }
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.CACHING_ERROR,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        message: (err as Error).message,
      });
    }
  }

  const processedColumns = new Map<RootHex, number[]>();
  let numberOfColumns = 0;
  if (columnSidecars) {
    try {
      for (const columnSidecar of columnSidecars) {
        const blockInput = cache.getBlockInputByColumn({
          peerIdStr,
          columnSidecar,
          seenTimestampSec,
          source: BlockInputSourceType.byRange,
        });
        numberOfColumns++;
        blockInputs.set(blockInput.rootHex, blockInput);
        const indices = processedBlobs.get(blockInput.rootHex) ?? [];
        indices.push(columnSidecar.index);
        processedBlobs.set(blockInput.rootHex, indices);
      }
    } catch (err) {
      chain.logger.verbose(
        "Error caching ByRange fetched column",
        {peerId: prettyPrintPeerIdStr(peerIdStr)},
        err as Error
      );
      uncacheColumns(processedColumns);
      if (numberOfBlocks !== 0) {
        uncacheBlocks();
      }
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.CACHING_ERROR,
        peerId: prettyPrintPeerIdStr(peerIdStr),
        message: (err as Error).message,
      });
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
  network,
  chain,
  config,
  peerIdStr,
  dataAvailabilityStatus,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: DownloadAndCacheByRangeProps): Promise<DownloadByRangeResponses> {
  const startSlot = (blocksRequest?.startSlot ?? blobsRequest?.startSlot ?? columnsRequest?.startSlot) as number;
  const count = (blocksRequest?.count ?? blobsRequest?.count ?? columnsRequest?.count) as number;
  const slotRangeString = `${startSlot} - ${startSlot + count}`;

  // TODO: should we check for requests across a fork boundary?

  if (dataAvailabilityStatus === DataAvailabilityStatus.Available) {
    const forkName = config.getForkName(startSlot);
    if (isForkBlobs(forkName) && !blobsRequest) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST,
        slotRange: slotRangeString,
      });
    }
    if (isForkPostFulu(forkName) && !columnsRequest) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST,
        slotRange: slotRangeString,
      });
    }
  }

  const dataRequest = blobsRequest ?? columnsRequest;
  if (blocksRequest && dataRequest) {
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
  }

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
    chain.logger.verbose("RangeSync *ByRange error", {}, err as Error);
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR,
      peerId: peerIdStr,
      slotRange: slotRangeString,
    });
  }

  compareByRangeRequestsToResponse({
    peerIdStr,
    slotRangeString,
    blocksRequest,
    blobsRequest,
    columnsRequest,
    ...response,
  });

  return response;
}

// Should not be called directly. Only exported for unit testing purposes
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
  let blocks: undefined | WithBytes<SignedBeaconBlock>[];
  let blobSidecars: undefined | deneb.BlobSidecars;
  let columnSidecars: undefined | fulu.DataColumnSidecars;

  const requests: Promise<unknown>[] = [];

  if (blocksRequest) {
    requests.push(
      network.sendBeaconBlocksByRange(peerIdStr, blocksRequest).then((blockResponse) => {
        blocks = blockResponse;
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

// Should not be called directly. Only exported for unit testing purposes
export function compareBlockByRangeRequestAndResponse(
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blocks: WithBytes<SignedBeaconBlock>[]
): {missingSlots: number[]} {
  const {startSlot, count} = blocksRequest;
  const slotsReceived = blocks.map((block) => block.data.message.slot);

  const missingSlots: number[] = [];
  for (let slot = startSlot; slot < startSlot + count; slot++) {
    if (!slotsReceived.includes(slot)) {
      missingSlots.push(slot);
    }
  }

  return {
    missingSlots,
  };
}

type BlobComparisonResponse = {
  expectedBlobCount: number;
  missingBlobCount: number;
  missingBlobsDescription: string[];
};
// Should not be called directly. Only exported for unit testing purposes
export function compareBlobsByRangeRequestAndResponse(
  blocks: WithBytes<SignedBeaconBlock>[],
  blobSidecars: deneb.BlobSidecars
): BlobComparisonResponse {
  let expectedBlobCount = 0;
  let missingBlobCount = 0;
  const missingBlobsDescription: string[] = [];
  for (const block of blocks) {
    const slot = block.data.message.slot;
    const expectedBlobs = (block.data as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
    expectedBlobCount += expectedBlobs;
    const receivedBlobs = blobSidecars
      .filter((blobSidecar) => blobSidecar.signedBlockHeader.message.slot === slot)
      .map((blobSidecar) => blobSidecar.index);

    const missingIndices: number[] = [];
    for (const index of linspace(0, expectedBlobs - 1)) {
      if (!receivedBlobs.includes(index)) {
        missingIndices.push(index);
      }
    }
    if (missingIndices.length > 0) {
      missingBlobCount += missingIndices.length;
      missingBlobsDescription.push(`${slot}${prettyPrintArray(missingIndices)}`);
    }
  }

  return {
    expectedBlobCount,
    missingBlobCount,
    missingBlobsDescription,
  };
}

type ColumnComparisonResponse = {
  missingByIndex: Map<number, Slot[]>;
  extraByIndex: Map<number, Slot[]>;
};
// Should not be called directly. Only exported for unit testing purposes
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

// Should not be called directly. Only exported for unit testing purposes
export function compareByRangeRequestsToResponse({
  peerIdStr,
  slotRangeString,
  blocksRequest,
  blobsRequest,
  columnsRequest,
  blocks,
  blobSidecars,
  columnSidecars,
}: DownloadByRangeRequests & DownloadByRangeResponses & {peerIdStr: string; slotRangeString: string}): void {
  if (blocksRequest) {
    if (!blocks) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
          slotRange: slotRangeString,
        },
        "No blocks to check blockRequest against"
      );
    }
    const {missingSlots} = compareBlockByRangeRequestAndResponse(blocksRequest, blocks);

    if (missingSlots) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOCKS,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          missingSlots: prettyPrintArray(missingSlots),
        },
        "Not all blocks included in BeaconBlocksByRange response"
      );
    }
  }

  if (blobsRequest) {
    if (!blocks) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
          slotRange: slotRangeString,
        },
        "Must request blocks and blobs together when doing a *ByRange request"
      );
    }
    if (!blobSidecars) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE,
          slotRange: slotRangeString,
        },
        "No blobSidecars to check blobRequest against"
      );
    }

    const {expectedBlobCount, missingBlobCount, missingBlobsDescription} = compareBlobsByRangeRequestAndResponse(
      blocks,
      blobSidecars
    );

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
          partialExtraColumns.push(`${index}${prettyPrintArray(extraSlots)}`);
        }
      }

      if (fullExtraColumns.length) {
        // this should be severe peer infraction
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.EXTRA_COLUMNS_ALL_SLOTS,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          extraColumns: prettyPrintArray(fullExtraColumns),
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
          indicesWithSlots.push(`${index}${prettyPrintArray(missingSlots)}`);
        }
      }

      if (missingPeerCustody.length) {
        // this should be a severe peer infraction
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.PEER_CUSTODY_FAILURE,
          peerId: prettyPrintPeerIdStr(peerIdStr),
          missingColumns: prettyPrintArray(missingPeerCustody),
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

export enum DownloadByRangeErrorCode {
  MISSING_BLOCKS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS_RESPONSE",
  MISSING_BLOBS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_REQUEST",
  MISSING_COLUMNS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_REQUEST",
  MISSING_BLOBS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_RESPONSE",
  MISSING_COLUMNS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_RESPONSE",
  START_SLOT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_START_SLOT_MISMATCH",
  COUNT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_COUNT_MISMATCH",
  REQ_RESP_ERROR = "DOWNLOAD_BY_RANGE_ERROR_REQ_RESP_ERROR",
  MISSING_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS",
  MISSING_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS",
  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",
  EXTRA_COLUMNS_ALL_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_ALL_SLOTS",
  EXTRA_COLUMNS_SOME_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_SOME_SLOTS",
  PEER_CUSTODY_FAILURE = "DOWNLOAD_BY_RANGE_ERROR_PEER_CUSTODY_FAILURE",
  CACHING_ERROR = "DOWNLOAD_BY_RANGE_CACHING_ERROR",
}

export type DownloadByRangeErrorType =
  | {
      code:
        | DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST
        | DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST
        | DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE;
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
      code: DownloadByRangeErrorCode.MISSING_BLOBS;
      peerId: string;
      expectedBlobCount: number;
      missingBlobCount: number;
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
