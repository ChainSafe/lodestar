import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, ForkPostFulu} from "@lodestar/params";
import {SignedBeaconBlock, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, Logger, fromHex, prettyBytes, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {
  BlockInputSource,
  DAType,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlockBlobSidecars} from "../../chain/validation/blobSidecar.js";
import {validateBlockDataColumnSidecars} from "../../chain/validation/dataColumnSidecar.js";
import {INetwork} from "../../network/index.js";
import {PeerIdStr} from "../../util/peerId.js";
import {WarnResult} from "../../util/wrapError.js";
import {DownloadByRootErrorCode} from "./downloadByRoot.js";

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

export type DownloadAndCacheByRangeProps = DownloadByRangeRequests & {
  config: ChainForkConfig;
  cache: SeenBlockInput;
  network: INetwork;
  logger: Logger;
  peerIdStr: string;
  batchBlocks?: IBlockInput[];
};

export type CacheByRangeResponsesProps = {
  cache: SeenBlockInput;
  peerIdStr: string;
  responses: ValidatedResponses;
  batchBlocks: IBlockInput[];
};

export type ValidatedBlock = {
  blockRoot: Uint8Array;
  block: SignedBeaconBlock;
};

export type ValidatedBlobSidecars = {
  blockRoot: Uint8Array;
  blobSidecars: deneb.BlobSidecars;
};

export type ValidatedColumnSidecars = {
  blockRoot: Uint8Array;
  columnSidecars: fulu.DataColumnSidecars;
};

export type ValidatedResponses = {
  validatedBlocks?: ValidatedBlock[];
  validatedBlobSidecars?: ValidatedBlobSidecars[];
  validatedColumnSidecars?: ValidatedColumnSidecars[];
};

/**
 * Given existing cached batch block inputs and newly validated responses, update the cache with the new data
 */
export function cacheByRangeResponses({
  cache,
  peerIdStr,
  responses,
  batchBlocks,
}: CacheByRangeResponsesProps): IBlockInput[] {
  const source = BlockInputSource.byRange;
  const seenTimestampSec = Date.now() / 1000;
  const updatedBatchBlocks = new Map<Slot, IBlockInput>(batchBlocks.map((block) => [block.slot, block]));

  const blocks = responses.validatedBlocks ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const {block, blockRoot} = blocks[i];
    const blockRootHex = toRootHex(blockRoot);

    const existing = updatedBatchBlocks.get(block.message.slot);
    if (existing) {
      // In practice this code block shouldn't be reached because we shouldn't be refetching a block we already have, see Batch#getRequests.
      // Will throw if root hex does not match (meaning we are following the wrong chain)
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
      const blockInput = cache.getByBlock({
        block,
        blockRootHex,
        source,
        peerIdStr,
        seenTimestampSec,
      });
      updatedBatchBlocks.set(blockInput.slot, blockInput);
    }
  }

  for (const {blockRoot, blobSidecars} of responses.validatedBlobSidecars ?? []) {
    const existing = updatedBatchBlocks.get(blobSidecars[0].signedBlockHeader.message.slot);
    const blockRootHex = toRootHex(blockRoot);

    if (!existing) {
      throw new Error("Coding error: blockInput must exist when adding blobs");
    }

    if (!isBlockInputBlobs(existing)) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
        slot: existing.slot,
        blockRoot: prettyBytes(existing.blockRootHex),
        expected: DAType.Blobs,
        actual: existing.type,
      });
    }
    for (const blobSidecar of blobSidecars) {
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
    }
  }

  for (const {blockRoot, columnSidecars} of responses.validatedColumnSidecars ?? []) {
    const existing = updatedBatchBlocks.get(columnSidecars[0].signedBlockHeader.message.slot);
    const blockRootHex = toRootHex(blockRoot);

    if (!existing) {
      throw new Error("Coding error: blockInput must exist when adding blobs");
    }

    if (!isBlockInputColumns(existing)) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
        slot: existing.slot,
        blockRoot: prettyBytes(existing.blockRootHex),
        expected: DAType.Columns,
        actual: existing.type,
      });
    }
    for (const columnSidecar of columnSidecars) {
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
    }
  }

  return Array.from(updatedBatchBlocks.values());
}

export async function downloadByRange({
  config,
  network,
  peerIdStr,
  batchBlocks,
  blocksRequest,
  blobsRequest,
  columnsRequest,
}: Omit<DownloadAndCacheByRangeProps, "cache">): Promise<WarnResult<ValidatedResponses, DownloadByRangeError>> {
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
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR,
      reason: (err as Error).message,
      ...requestsLogMeta({blocksRequest, blobsRequest, columnsRequest}),
    });
  }

  const validated = await validateResponses({
    config,
    batchBlocks,
    blocksRequest,
    blobsRequest,
    columnsRequest,
    ...response,
  });

  return validated;
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
export async function validateResponses({
  config,
  batchBlocks,
  blocksRequest,
  blobsRequest,
  columnsRequest,
  blocks,
  blobSidecars,
  columnSidecars,
}: DownloadByRangeRequests &
  DownloadByRangeResponses & {
    config: ChainForkConfig;
    batchBlocks?: IBlockInput[];
  }): Promise<WarnResult<ValidatedResponses, DownloadByRangeError>> {
  // Blocks are always required for blob/column validation
  // If a blocksRequest is provided, blocks have just been downloaded
  // If no blocksRequest is provided, batchBlocks must have been provided from cache
  if ((blobsRequest || columnsRequest) && !(blocks || batchBlocks)) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS,
        ...requestsLogMeta({blobsRequest, columnsRequest}),
      },
      "No blocks to validate data requests against"
    );
  }

  const validatedResponses: ValidatedResponses = {};
  let warnings: DownloadByRangeError[] | null = null;

  if (blocksRequest) {
    validatedResponses.validatedBlocks = validateBlockByRangeResponse(config, blocksRequest, blocks ?? []);
  }

  const dataRequest = blobsRequest ?? columnsRequest;
  if (!dataRequest) {
    return {result: validatedResponses, warnings: null};
  }

  const dataRequestBlocks = getBlocksForDataValidation(
    dataRequest,
    batchBlocks,
    blocksRequest ? validatedResponses.validatedBlocks : undefined
  );

  if (!dataRequestBlocks.length) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS,
        ...requestsLogMeta({blobsRequest, columnsRequest}),
      },
      "No blocks in data request slot range to validate data response against"
    );
  }

  if (blobsRequest) {
    if (!blobSidecars) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE,
          ...requestsLogMeta({blobsRequest, columnsRequest}),
        },
        "No blobSidecars to validate against blobsRequest"
      );
    }

    validatedResponses.validatedBlobSidecars = await validateBlobsByRangeResponse(dataRequestBlocks, blobSidecars);
  }

  if (columnsRequest) {
    if (!columnSidecars) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE,
          ...requestsLogMeta({blobsRequest, columnsRequest}),
        },
        "No columnSidecars to check columnRequest against"
      );
    }

    const validatedColumnSidecarsResult = await validateColumnsByRangeResponse(
      columnsRequest,
      dataRequestBlocks,
      columnSidecars
    );
    validatedResponses.validatedColumnSidecars = validatedColumnSidecarsResult.result;
    warnings = validatedColumnSidecarsResult.warnings;
  }

  return {result: validatedResponses, warnings};
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 *
 * - check all slots are within range of startSlot (inclusive) through startSlot + count (exclusive)
 * - don't have more than count number of blocks
 * - slots are in ascending order
 * - must allow for skip slots
 * - check is a chain of blocks where via parentRoot matches hashTreeRoot of block before
 */
export function validateBlockByRangeResponse(
  config: ChainForkConfig,
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blocks: SignedBeaconBlock[]
): ValidatedBlock[] {
  const {startSlot, count} = blocksRequest;

  // TODO(fulu): This was added by @twoeths in #8150 but it breaks for epochs with 0 blocks during chain
  //    liveness issues. See comment https://github.com/ChainSafe/lodestar/issues/8147#issuecomment-3246434697
  // if (!blocks.length) {
  //   throw new DownloadByRangeError(
  //     {
  //       code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
  //       expectedCount: blocksRequest.count,
  //     },
  //     "Zero blocks in response"
  //   );
  // }

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

  const lastValidSlot = startSlot + count - 1;
  for (let i = 0; i < blocks.length; i++) {
    const slot = blocks[i].message.slot;

    if (slot < startSlot || slot > lastValidSlot) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS,
          slot,
        },
        "Blocks in response outside of requested slot range"
      );
    }

    // do not check for out of order on first block, and for subsequent blocks make sure that
    // the current block in a later slot than the one prior
    if (i !== 0 && slot <= blocks[i - 1].message.slot) {
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOCKS,
        },
        "Blocks out of order in BeaconBlocksByRange response"
      );
    }
  }

  // assumes all blocks are from the same fork. Batch only generated epoch-wise requests starting at slot
  // 0 of the epoch
  const type = config.getForkTypes(blocks[0].message.slot).BeaconBlock;
  const response: {block: SignedBeaconBlock; blockRoot: Uint8Array}[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockRoot = type.hashTreeRoot(block.message);
    response.push({block, blockRoot});

    if (i < blocks.length - 1) {
      // compare the block root against the next block's parent root
      const parentRoot = blocks[i + 1].message.parentRoot;
      if (Buffer.compare(blockRoot, parentRoot) !== 0) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.PARENT_ROOT_MISMATCH,
            slot: blocks[i].message.slot,
            expected: prettyBytes(blockRoot),
            actual: prettyBytes(parentRoot),
          },
          `Block parent root does not match the previous block's root in BeaconBlocksByRange response`
        );
      }
    }
  }

  return response;
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export async function validateBlobsByRangeResponse(
  dataRequestBlocks: ValidatedBlock[],
  blobSidecars: deneb.BlobSidecars
): Promise<ValidatedBlobSidecars[]> {
  const expectedBlobCount = dataRequestBlocks.reduce(
    (acc, {block}) => (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length + acc,
    0
  );
  if (blobSidecars.length > expectedBlobCount) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.EXTRA_BLOBS,
        expected: expectedBlobCount,
        actual: blobSidecars.length,
      },
      "Extra blobs received in BlobSidecarsByRange response"
    );
  }
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

  const validateSidecarsPromises: Promise<ValidatedBlobSidecars>[] = [];
  for (let blockIndex = 0, blobSidecarIndex = 0; blockIndex < dataRequestBlocks.length; blockIndex++) {
    const {block, blockRoot} = dataRequestBlocks[blockIndex];
    const blockKzgCommitments = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments;
    if (blockKzgCommitments.length === 0) {
      continue;
    }

    const blockBlobSidecars = blobSidecars.slice(blobSidecarIndex, blobSidecarIndex + blockKzgCommitments.length);
    blobSidecarIndex += blockKzgCommitments.length;

    for (let i = 0; i < blockBlobSidecars.length; i++) {
      if (blockBlobSidecars[i].index !== i) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOBS,
            slot: block.message.slot,
          },
          "Blob sidecars not in order or do not match expected indexes in BlobSidecarsByRange response"
        );
      }
    }

    validateSidecarsPromises.push(
      validateBlockBlobSidecars(block.message.slot, blockRoot, blockKzgCommitments.length, blockBlobSidecars).then(
        () => ({blockRoot, blobSidecars: blockBlobSidecars})
      )
    );
  }

  // Await all sidecar validations in parallel
  return Promise.all(validateSidecarsPromises);
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export async function validateColumnsByRangeResponse(
  request: fulu.DataColumnSidecarsByRangeRequest,
  dataRequestBlocks: ValidatedBlock[],
  columnSidecars: fulu.DataColumnSidecars
): Promise<WarnResult<ValidatedColumnSidecars[], DownloadByRangeError>> {
  // Expected column count considering currently-validated batch blocks
  const expectedColumnCount = dataRequestBlocks.reduce((acc, {block}) => {
    return (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length > 0
      ? request.columns.length + acc
      : acc;
  }, 0);
  const nextSlot = dataRequestBlocks.length
    ? (dataRequestBlocks.at(-1) as ValidatedBlock).block.message.slot + 1
    : request.startSlot;
  const possiblyMissingBlocks = nextSlot - request.startSlot + request.count;

  // Allow for extra columns if some blocks are missing from the end of a batch
  // Eg: If we requested 10 blocks but only 8 were returned, allow for up to 2 * columns.length extra columns
  const maxColumnCount = expectedColumnCount + possiblyMissingBlocks * request.columns.length;

  if (columnSidecars.length > maxColumnCount) {
    // this never happens on devnet, so throw error for now
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.OVER_COLUMNS,
        max: maxColumnCount,
        actual: columnSidecars.length,
      },
      "Extra data columns received in DataColumnSidecarsByRange response"
    );
  }

  const warnings: DownloadByRangeError[] = [];
  // no need to check for columnSidecars.length  vs expectedColumnCount here, will be checked per-block below
  const requestedColumns = new Set(request.columns);
  const validateSidecarsPromises: Promise<ValidatedColumnSidecars>[] = [];
  for (let blockIndex = 0, columnSidecarIndex = 0; blockIndex < dataRequestBlocks.length; blockIndex++) {
    const {block, blockRoot} = dataRequestBlocks[blockIndex];
    const slot = block.message.slot;
    const blockRootHex = toRootHex(blockRoot);
    const blockKzgCommitments = (block as SignedBeaconBlock<ForkPostFulu>).message.body.blobKzgCommitments;
    const expectedColumns = blockKzgCommitments.length ? request.columns.length : 0;

    if (expectedColumns === 0) {
      continue;
    }
    const blockColumnSidecars: fulu.DataColumnSidecar[] = [];
    while (columnSidecarIndex < columnSidecars.length) {
      const columnSidecar = columnSidecars[columnSidecarIndex];
      if (columnSidecar.signedBlockHeader.message.slot !== block.message.slot) {
        // We've reached columns for the next block
        break;
      }
      blockColumnSidecars.push(columnSidecar);
      columnSidecarIndex++;
    }

    const returnedColumns = new Set(blockColumnSidecars.map((c) => c.index));
    const missingIndices = request.columns.filter((i) => !returnedColumns.has(i));
    if (missingIndices.length > 0) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.MISSING_COLUMNS,
            slot,
            blockRoot: blockRootHex,
            missingIndices: prettyPrintIndices(missingIndices),
          },
          "Missing data columns in DataColumnSidecarsByRange response"
        )
      );
    }

    const extraIndices = [...returnedColumns].filter((i) => !requestedColumns.has(i));
    if (extraIndices.length > 0) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.EXTRA_COLUMNS,
            slot,
            blockRoot: blockRootHex,
            invalidIndices: prettyPrintIndices(extraIndices),
          },
          "Data column in not in requested columns in DataColumnSidecarsByRange response"
        )
      );
    }

    validateSidecarsPromises.push(
      validateBlockDataColumnSidecars(slot, blockRoot, blockKzgCommitments.length, blockColumnSidecars).then(() => ({
        blockRoot,
        columnSidecars: blockColumnSidecars,
      }))
    );
  }

  // Await all sidecar validations in parallel
  const result = await Promise.all(validateSidecarsPromises);
  return {result, warnings: warnings.length ? warnings : null};
}

/**
 * Given a data request, return only the blocks and roots that correspond to the data request (sorted). Assumes that
 * cached have slots that are all before the current batch of downloaded blocks
 */
export function getBlocksForDataValidation(
  dataRequest: {startSlot: Slot; count: number},
  cached: IBlockInput[] | undefined,
  current: ValidatedBlock[] | undefined
): ValidatedBlock[] {
  const startSlot = dataRequest.startSlot;
  const endSlot = startSlot + dataRequest.count;

  // Organize cached blocks and current blocks, only including those in the requested slot range
  const dataRequestBlocks: ValidatedBlock[] = [];
  let lastSlot = startSlot - 1;

  if (cached) {
    for (let i = 0; i < cached.length; i++) {
      const blockInput = cached[i];
      if (blockInput.slot >= startSlot && blockInput.slot < endSlot && blockInput.slot > lastSlot) {
        dataRequestBlocks.push({block: blockInput.getBlock(), blockRoot: fromHex(blockInput.blockRootHex)});
        lastSlot = blockInput.slot;
      }
    }
  }

  if (current) {
    for (let i = 0; i < current.length; i++) {
      const block = current[i].block;
      if (block.message.slot >= startSlot && block.message.slot < endSlot && block.message.slot > lastSlot) {
        dataRequestBlocks.push(current[i]);
        lastSlot = block.message.slot;
      }
    }
  }

  return dataRequestBlocks;
}

function requestsLogMeta({blocksRequest, blobsRequest, columnsRequest}: DownloadByRangeRequests) {
  const logMeta: {
    blockStartSlot?: number;
    blockCount?: number;
    blobStartSlot?: number;
    blobCount?: number;
    columnStartSlot?: number;
    columnCount?: number;
  } = {};
  if (blocksRequest) {
    logMeta.blockStartSlot = blocksRequest.startSlot;
    logMeta.blockCount = blocksRequest.count;
  }
  if (blobsRequest) {
    logMeta.blobStartSlot = blobsRequest.startSlot;
    logMeta.blobCount = blobsRequest.count;
  }
  if (columnsRequest) {
    logMeta.columnStartSlot = columnsRequest.startSlot;
    logMeta.columnCount = columnsRequest.count;
  }
  return logMeta;
}

export enum DownloadByRangeErrorCode {
  MISSING_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS",
  MISSING_BLOBS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_RESPONSE",
  MISSING_COLUMNS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_RESPONSE",

  /** Error at the reqresp layer */
  REQ_RESP_ERROR = "DOWNLOAD_BY_RANGE_ERROR_REQ_RESP_ERROR",

  // Errors validating a chain of blocks (not considering associated data)

  PARENT_ROOT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_PARENT_ROOT_MISMATCH",
  EXTRA_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOCKS",
  OUT_OF_RANGE_BLOCKS = "DOWNLOAD_BY_RANGE_OUT_OF_RANGE_BLOCKS",
  OUT_OF_ORDER_BLOCKS = "DOWNLOAD_BY_RANGE_OUT_OF_ORDER_BLOCKS",

  MISSING_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS",
  OUT_OF_ORDER_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_OUT_OF_ORDER_BLOBS",
  EXTRA_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_BLOBS",

  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",
  OVER_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_OVER_COLUMNS",
  EXTRA_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS",

  /** Cached block input type mismatches new data */
  MISMATCH_BLOCK_INPUT_TYPE = "DOWNLOAD_BY_RANGE_ERROR_MISMATCH_BLOCK_INPUT_TYPE",
}

export type DownloadByRangeErrorType =
  | {
      code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE;
      expectedCount: number;
    }
  | {
      code:
        | DownloadByRangeErrorCode.MISSING_BLOCKS
        | DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE;
      blockStartSlot?: number;
      blockCount?: number;
      blobStartSlot?: number;
      blobCount?: number;
      columnStartSlot?: number;
      columnCount?: number;
    }
  | {
      code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE;
      expectedCount: number;
    }
  | {
      code: DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS;
      slot: number;
    }
  | {
      code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOCKS;
    }
  | {
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR;
      blockStartSlot?: number;
      blockCount?: number;
      blobStartSlot?: number;
      blobCount?: number;
      columnStartSlot?: number;
      columnCount?: number;
      reason: string;
    }
  | {
      code: DownloadByRangeErrorCode.PARENT_ROOT_MISMATCH;
      slot: number;
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
      code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOBS;
      slot: number;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_BLOBS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.OVER_COLUMNS;
      max: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_COLUMNS;
      slot: Slot;
      blockRoot: string;
      missingIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_COLUMNS;
      slot: Slot;
      blockRoot: string;
      invalidIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE;
      slot: number;
      blockRoot: string;
      expected: DAType;
      actual: DAType;
    };

export class DownloadByRangeError extends LodestarError<DownloadByRangeErrorType> {}
