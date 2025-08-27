import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {SignedBeaconBlock, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, Logger, prettyBytes, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {
  BlockInputSource,
  DAType,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {INetwork, prettyPrintPeerIdStr} from "../../network/index.js";
import {PeerIdStr} from "../../util/peerId.js";
import {RangeSyncType} from "./remoteSyncType.js";

export type DownloadByRangeRequests = {
  blocksRequest?: phase0.BeaconBlocksByRangeRequest;
  blobsRequest?: deneb.BlobSidecarsByRangeRequest;
  columnsRequest?: fulu.DataColumnSidecarsByRangeRequest;
};

export type DownloadByRangeResponses = {
  blocks?: SignedBeaconBlock[];
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export type ValidatedDownloadByRangeResponses = DownloadByRangeResponses & {
  blockRoots?: Uint8Array[];
};

export type DownloadAndCacheByRangeProps = DownloadByRangeRequests & {
  config: ChainForkConfig;
  cache: SeenBlockInput;
  network: INetwork;
  logger: Logger;
  peerIdStr: string;
  daOutOfRange: boolean;
  batchBlocks?: IBlockInput[];
};

export type DownloadAndCacheByRangeResults = {
  blockInputs: IBlockInput[];
  numberOfBlocks: number;
  numberOfBlobs: number;
  numberOfColumns: number;
};

export type CacheByRangeResponsesProps = {
  config: ChainForkConfig;
  cache: SeenBlockInput;
  syncType: RangeSyncType;
  peerIdStr: PeerIdStr;
  responses: ValidatedDownloadByRangeResponses;
  batchBlocks: IBlockInput[];
};

export function cacheByRangeResponses({
  config,
  cache,
  // syncType,
  peerIdStr,
  responses,
  batchBlocks,
}: CacheByRangeResponsesProps): IBlockInput[] {
  const source = BlockInputSource.byRange;
  const seenTimestampSec = Date.now() / 1000;
  const updatedBatchBlocks = [...batchBlocks];

  const blocks = responses.blocks ?? [];
  const blockRoots = responses.blockRoots ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const existing = updatedBatchBlocks.find((b) => b.slot === block.message.slot);
    const blockRoot = blockRoots[i] ?? config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    const blockRootHex = toRootHex(blockRoot);
    if (existing) {
      // will throw if root hex does not match (meaning we are following the wrong chain)
      existing.addBlock(
        {
          block,
          blockRootHex,
          source,
          peerIdStr,
          seenTimestampSec,
        },
        {throwOnDuplicateAdd: false}
      );
    } else {
      updatedBatchBlocks.push(
        cache.getByBlock({
          block,
          blockRootHex,
          source,
          peerIdStr,
          seenTimestampSec,
        })
      );
    }
  }

  for (const blobSidecar of responses.blobSidecars ?? []) {
    const blockRoot = config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    const blockRootHex = toRootHex(blockRoot);
    const existing = updatedBatchBlocks.find((b) => b.slot === blobSidecar.signedBlockHeader.message.slot);
    if (existing) {
      if (!isBlockInputBlobs(existing)) {
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
          cachedType: existing.type,
          expectedType: DAType.Blobs,
          slot: existing.slot,
          blockRoot: prettyBytes(existing.blockRootHex),
        });
      }
      // will throw if root hex does not match (meaning we are following the wrong chain)
      existing.addBlob(
        {
          blobSidecar,
          blockRootHex,
          seenTimestampSec,
          peerIdStr,
          source,
        },
        {throwOnDuplicateAdd: false}
      );
    } else {
      updatedBatchBlocks.push(
        cache.getByBlob({
          blockRootHex,
          blobSidecar,
          source,
          peerIdStr,
          seenTimestampSec,
        })
      );
    }
  }

  for (const columnSidecar of responses.columnSidecars ?? []) {
    const blockRoot = config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    const blockRootHex = toRootHex(blockRoot);
    const existing = updatedBatchBlocks.find((b) => b.slot === columnSidecar.signedBlockHeader.message.slot);
    if (existing) {
      if (!isBlockInputColumns(existing)) {
        throw new DownloadByRangeError({
          code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
          cachedType: existing.type,
          expectedType: DAType.Columns,
          slot: existing.slot,
          blockRoot: prettyBytes(existing.blockRootHex),
        });
      }
      // will throw if root hex does not match (meaning we are following the wrong chain)
      existing.addColumn(
        {
          columnSidecar,
          blockRootHex,
          seenTimestampSec,
          peerIdStr,
          source,
        },
        {throwOnDuplicateAdd: false}
      );
    } else {
      updatedBatchBlocks.push(
        cache.getByColumn({
          blockRootHex,
          columnSidecar,
          source,
          peerIdStr,
          seenTimestampSec,
        })
      );
    }
  }

  return updatedBatchBlocks;
}

export async function downloadByRange({
  config,
  network,
  logger,
  peerIdStr,
  batchBlocks,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: Omit<DownloadAndCacheByRangeProps, "cache">): Promise<ValidatedDownloadByRangeResponses> {
  const startSlot = (blocksRequest?.startSlot ?? blobsRequest?.startSlot ?? columnsRequest?.startSlot) as number;
  const count = (blocksRequest?.count ?? blobsRequest?.count ?? columnsRequest?.count) as number;
  const slotRangeString = `${startSlot} - ${startSlot + count}`;

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

  const blockRoots = validateResponses({
    config,
    peerIdStr,
    slotRangeString,
    blocksRequest,
    blobsRequest,
    columnsRequest,
    batchBlocks,
    ...response,
  });

  return {...response, blockRoots};
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function validateRequests({
  config,
  daOutOfRange,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: DownloadByRangeRequests & Pick<DownloadAndCacheByRangeProps, "config" | "daOutOfRange">): string {
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

  if (daOutOfRange) {
    if (dataRequest) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
          slotRange,
        },
        "Cannot request data if it is outside of the availability range"
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
  config,
  peerIdStr,
  slotRangeString,
  blocksRequest,
  blobsRequest,
  columnsRequest,
  blocks,
  blobSidecars,
  columnSidecars,
  batchBlocks,
}: DownloadByRangeRequests &
  DownloadByRangeResponses & {
    config: ChainForkConfig;
    peerIdStr: string;
    slotRangeString: string;
    batchBlocks?: IBlockInput[];
  }): Uint8Array[] | undefined {
  // Blocks are always required for blob/column validation
  // If a blocksRequest is provided, blocks have just been downloaded
  // If no blocksRequest is provided, batchBlocks must have been provided from cache
  if (blocksRequest && !blocks) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
        slotRange: slotRangeString,
      },
      "No blocks request to validate requests against"
    );
  }
  if (!blocksRequest && !batchBlocks) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
        slotRange: slotRangeString,
      },
      "No blocks request to validate requests against"
    );
  }

  // Set blocks for validation below
  // blocks = blocks ?? batchBlocks?.map((blockInput) => blockInput.getBlock()) ?? [];

  const blockRoots = blocksRequest ? validateBlockByRangeResponse(config, blocksRequest, blocks ?? []) : undefined;

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

    validateBlobsByRangeResponse(
      [...(blocks ?? []), ...(batchBlocks?.map((blockInput) => blockInput.getBlock()) ?? [])],
      blobSidecars
    );
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
  return blockRoots;
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function validateBlockByRangeResponse(
  config: ChainForkConfig,
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blocks: SignedBeaconBlock[]
): Uint8Array[] {
  const {startSlot, count} = blocksRequest;

  if (blocks.length > count) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.EXTRA_BLOCKS,
        expected: count,
        actual: blocks.length - count,
      },
      "Extra blocks received in BeaconBlocksByRange response"
    );
  }

  const lastValidSlot = startSlot + count;
  for (let i = 0; i < blocks.length; i++) {
    const slot = blocks[i].message.slot;

    if (slot > lastValidSlot) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS,
        },
        "Blocks with slots outside of requested range in BeaconBlocksByRange response"
      );
    }
    if (i < blocks.length - 1 && slot >= blocks[i + 1].message.slot) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOCKS,
        },
        "Blocks out of order in BeaconBlocksByRange response"
      );
    }
  }

  const blockRoots = blocks.map((block) =>
    config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message)
  );
  for (let i = 0; i < blocks.length - 1; i++) {
    // compare the block root against the next block's parent root
    const blockRoot = blockRoots[i];
    const parentRoot = blocks[i + 1].message.parentRoot;
    if (Buffer.compare(blockRoot, parentRoot) !== 0) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.PARENT_ROOT_MISMATCH,
          parentSlot: blocks[i].message.slot,
          expected: toRootHex(blockRoot),
          actual: toRootHex(parentRoot),
        },
        `Block parent root does not match the previous block's root in BeaconBlocksByRange response`
      );
    }
  }
  return blockRoots;
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export function validateBlobsByRangeResponse(blocks: SignedBeaconBlock[], blobSidecars: deneb.BlobSidecars): void {
  const expectedBlobCount = blocks.reduce(
    (acc, block) => (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length + acc,
    0
  );
  // if (blobSidecars.length > expectedBlobCount) {
  //   throw new DownloadByRangeError(
  //     {
  //       code: DownloadByRangeErrorCode.EXTRA_BLOBS,
  //       expected: expectedBlobCount,
  //       actual: blobSidecars.length,
  //     },
  //     "Extra blobs received in BlobSidecarsByRange response"
  //   );
  // }
  if (blobSidecars.length < expectedBlobCount) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOBS,
        expected: expectedBlobCount,
        actual: blobSidecars.length,
      },
      "Missing blobs in BlobSidecarsByRange response"
    );
  }
  // cheap sanity checks (proper validation is done in the caching step)
  for (let blockIndex = 0, blobSidecarIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    const expectedBlobs = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
    for (let i = 0; i < expectedBlobs; i++, blobSidecarIndex++) {
      const blobSidecar = blobSidecars[blobSidecarIndex];
      const slot = block.message.slot;
      if (blobSidecar.signedBlockHeader.message.slot !== slot) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.WRONG_SLOT_BLOBS,
            expected: slot,
            actual: blobSidecar.signedBlockHeader.message.slot,
          },
          "BlobSidecar doesn't match corresponding block in BlobSidecarsByRange response"
        );
      }
      if (blobSidecar.index !== i) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.WRONG_INDEX_BLOBS,
            slot,
            expected: i,
            actual: blobSidecar.index,
          },
          "BlobSidecar out of order in BlobSidecarsByRange response"
        );
      }
    }
  }
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
  PARENT_ROOT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_PARENT_ROOT_MISMATCH",
  EXTRA_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOCKS",
  OUT_OF_RANGE_BLOCKS = "DOWNLOAD_BY_RANGE_OUT_OF_RANGE_BLOCKS",
  OUT_OF_ORDER_BLOCKS = "DOWNLOAD_BY_RANGE_OUT_OF_ORDER_BLOCKS",
  MISSING_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS",
  EXTRA_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOBS",
  WRONG_SLOT_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_SLOT_BLOBS",
  WRONG_INDEX_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_INDEX_BLOBS",
  DUPLICATE_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_DUPLICATE_BLOBS",
  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",
  EXTRA_COLUMNS_ALL_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_ALL_SLOTS",
  EXTRA_COLUMNS_SOME_SLOTS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS_SOME_SLOTS",
  PEER_CUSTODY_FAILURE = "DOWNLOAD_BY_RANGE_ERROR_PEER_CUSTODY_FAILURE",
  CACHING_ERROR = "DOWNLOAD_BY_RANGE_CACHING_ERROR",
  MISMATCH_BLOCK_INPUT_TYPE = "DOWNLOAD_BY_RANGE_MISMATCH_BLOCK_INPUT_TYPE",
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
      code: DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS;
    }
  | {
      code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOCKS;
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
      code: DownloadByRangeErrorCode.PARENT_ROOT_MISMATCH;
      parentSlot: number;
      expected: string;
      actual: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOCKS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_BLOBS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOBS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.WRONG_SLOT_BLOBS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.WRONG_INDEX_BLOBS;
      slot: number;
      expected: number;
      actual: number;
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
    }
  | {
      code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE;
      expectedType: DAType;
      cachedType: DAType;
      slot: Slot;
      blockRoot: string;
    };

export class DownloadByRangeError extends LodestarError<DownloadByRangeErrorType> {}
