import {ChainForkConfig} from "@lodestar/config";
import {
  ForkPostDeneb,
  ForkPostFulu,
  ForkPreFulu,
  ForkPreGloas,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {SignedBeaconBlock, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, Logger, fromHex, prettyPrintIndices, toRootHex} from "@lodestar/utils";
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
    const dataSlot = blobSidecars.at(0)?.signedBlockHeader.message.slot;
    if (dataSlot === undefined) {
      throw new Error(
        `Coding Error: empty blobSidecars returned for blockRoot=${toRootHex(blockRoot)} from validation functions`
      );
    }
    const existing = updatedBatchBlocks.get(dataSlot);
    const blockRootHex = toRootHex(blockRoot);

    if (!existing) {
      throw new Error("Coding error: blockInput must exist when adding blobs");
    }

    if (!isBlockInputBlobs(existing)) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
        slot: existing.slot,
        blockRoot: existing.blockRootHex,
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
    const dataSlot = columnSidecars.at(0)?.signedBlockHeader.message.slot;
    if (dataSlot === undefined) {
      throw new Error(
        `Coding Error: empty columnSidecars returned for blockRoot=${toRootHex(blockRoot)} from validation functions`
      );
    }
    const existing = updatedBatchBlocks.get(dataSlot);
    const blockRootHex = toRootHex(blockRoot);

    if (!existing) {
      throw new Error("Coding error: blockInput must exist when adding columns");
    }

    if (!isBlockInputColumns(existing)) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISMATCH_BLOCK_INPUT_TYPE,
        slot: existing.slot,
        blockRoot: existing.blockRootHex,
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
        code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
        ...requestsLogMeta({blobsRequest, columnsRequest}),
      },
      "No blocks to validate data requests against"
    );
  }

  const validatedResponses: ValidatedResponses = {};
  let warnings: DownloadByRangeError[] | null = null;

  if (blocksRequest) {
    const result = validateBlockByRangeResponse(config, blocksRequest, blocks ?? []);
    if (result.warnings?.length) {
      warnings = result.warnings;
    }
    validatedResponses.validatedBlocks = result.result;
  }

  const dataRequest = blobsRequest ?? columnsRequest;
  if (!dataRequest) {
    return {result: validatedResponses, warnings};
  }

  const blocksForDataValidation = getBlocksForDataValidation(
    dataRequest,
    batchBlocks,
    validatedResponses.validatedBlocks?.length ? validatedResponses.validatedBlocks : undefined
  );

  if (!blocksForDataValidation.length) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
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

    validatedResponses.validatedBlobSidecars = await validateBlobsByRangeResponse(
      blocksForDataValidation,
      blobSidecars
    );
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
      config,
      columnsRequest,
      blocksForDataValidation,
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
): WarnResult<ValidatedBlock[], DownloadByRangeError> {
  const {startSlot, count} = blocksRequest;

  // An error was thrown here by @twoeths in #8150 but it breaks for epochs with 0 blocks during chain
  // liveness issues. See comment https://github.com/ChainSafe/lodestar/issues/8147#issuecomment-3246434697
  // There are instances where clients return no blocks though.  Need to monitor this via the warns to see
  // if what the correct behavior should be
  if (!blocks.length) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
      ...requestsLogMeta({blocksRequest}),
    });
    // TODO: this was causing deadlock again. need to come back and fix this so that its possible to process through
    //       an empty epoch for periods with poor liveness
    // return {
    //   result: [],
    //   warnings: [
    //     new DownloadByRangeError({
    //       code: DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE,
    //       ...requestsLogMeta({blocksRequest}),
    //     }),
    //   ],
    // };
  }

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
            expected: toRootHex(blockRoot),
            actual: toRootHex(parentRoot),
          },
          `Block parent root does not match the previous block's root in BeaconBlocksByRange response`
        );
      }
    }
  }

  return {
    result: response,
    warnings: null,
  };
}

/**
 * Should not be called directly. Only exported for unit testing purposes.
 * This is used only in Deneb and Electra
 */
export async function validateBlobsByRangeResponse(
  dataRequestBlocks: ValidatedBlock[],
  blobSidecars: deneb.BlobSidecars
): Promise<ValidatedBlobSidecars[]> {
  const expectedBlobCount = dataRequestBlocks.reduce(
    (acc, {block}) =>
      (block as SignedBeaconBlock<ForkPostDeneb & ForkPreFulu>).message.body.blobKzgCommitments.length + acc,
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
    const blockKzgCommitments = (block as SignedBeaconBlock<ForkPostDeneb & ForkPreFulu>).message.body
      .blobKzgCommitments;
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
 *
 * Spec states:
 * 1) must be within range [start_slot, start_slot + count]
 * 2) should respond with all columns in the range or and 3:ResourceUnavailable (and potentially get down-scored)
 * 3) must response with at least the sidecars of the first blob-carrying block that exists in the range
 * 4) must include all sidecars from each block from which there are blobs
 * 5) where they exists, sidecars must be sent in (slot, index) order
 * 6) clients may limit the number of sidecars in a response
 * 7) clients may stop responding mid-response if their view of fork-choice changes
 *
 * We will interpret the spec as follows
 * - Errors when validating: 1, 3, 5
 * - Warnings when validating: 2, 4, 6, 7
 *
 * For "warning" cases, where we get a partial response but sidecars are validated and correct with respect to the
 * blocks, then they will be kept.  This loosening of the spec is to help ensure sync goes smoothly and we can find
 * the data needed in difficult network situations.
 *
 * Assume for the following two examples we request indices 5, 10, 15 for a range of slots 32-63
 *
 * For slots where we receive no sidecars, example slot 45, but blobs exist we will stop validating subsequent
 * slots, 45-63.  The next round of requests will get structured to pull the from the slot that had columns
 * missing to the end of the range for all columns indices that were requested for the current partially failed
 * request (slots 45-63 and indices 5, 10, 15).
 *
 * For slots where only some of the requested sidecars are received we will proceed with validation. For simplicity sake
 * we will assume that if we only get some indices back for a (or several) slot(s) that the indices we get will be
 * consistent. IE if a peer returns only index 5, they will most likely return that same index for subsequent slot
 * (index 5 for slots 34, 35, 36, etc). They will not likely return 5 on slot 34, 10 on slot 35, 15 on slot 36, etc.
 * This assumption makes the code simpler. For both cases the request for the next round will be structured correctly
 * to pull any missing column indices for whatever range remains.  The simplification just leads to re-verification
 * of the columns but the number of columns downloaded will be the same regardless of if they are validated twice.
 *
 * validateColumnsByRangeResponse makes some assumptions about the data being passed in
 * blocks are:
 * - slotwise in order
 * - form a chain
 * - non-sparse response (any missing block is a skipped slot not a bad response)
 * - last block is last slot received
 */
export async function validateColumnsByRangeResponse(
  config: ChainForkConfig,
  request: fulu.DataColumnSidecarsByRangeRequest,
  blocks: ValidatedBlock[],
  columnSidecars: fulu.DataColumnSidecars
): Promise<WarnResult<ValidatedColumnSidecars[], DownloadByRangeError>> {
  const warnings: DownloadByRangeError[] = [];

  const seenColumns = new Map<Slot, Map<number, fulu.DataColumnSidecar>>();
  let currentSlot = -1;
  let currentIndex = -1;
  // Check for duplicates and order
  for (const columnSidecar of columnSidecars) {
    const slot = columnSidecar.signedBlockHeader.message.slot;
    let seenSlotColumns = seenColumns.get(slot);
    if (!seenSlotColumns) {
      seenSlotColumns = new Map();
      seenColumns.set(slot, seenSlotColumns);
    }

    if (seenSlotColumns.has(columnSidecar.index)) {
      warnings.push(
        new DownloadByRangeError({
          code: DownloadByRangeErrorCode.DUPLICATE_COLUMN,
          slot,
          index: columnSidecar.index,
        })
      );

      continue;
    }

    if (currentSlot > slot) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.OUT_OF_ORDER_COLUMNS,
            slot,
          },
          "ColumnSidecars received out of slot order"
        )
      );
    }

    if (currentSlot === slot && currentIndex > columnSidecar.index) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.OUT_OF_ORDER_COLUMNS,
            slot,
          },
          "Column indices out of order within a slot"
        )
      );
    }

    seenSlotColumns.set(columnSidecar.index, columnSidecar);
    if (currentSlot !== slot) {
      // a new slot has started, reset index
      currentIndex = -1;
    } else {
      currentIndex = columnSidecar.index;
    }
    currentSlot = slot;
  }

  const validationPromises: Promise<ValidatedColumnSidecars>[] = [];

  for (const {blockRoot, block} of blocks) {
    const slot = block.message.slot;
    const rootHex = toRootHex(blockRoot);
    const forkName = config.getForkName(slot);
    const columnSidecarsMap: Map<number, fulu.DataColumnSidecar> = seenColumns.get(slot) ?? new Map();
    const columnSidecars = Array.from(columnSidecarsMap.values()).sort((a, b) => a.index - b.index);

    let blobCount: number;
    if (!isForkPostFulu(forkName)) {
      const dataSlot = columnSidecars.at(0)?.signedBlockHeader.message.slot;
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISMATCH_BLOCK_FORK,
        slot,
        blockFork: forkName,
        dataFork: dataSlot ? config.getForkName(dataSlot) : "unknown",
      });
    }
    if (isForkPostGloas(forkName)) {
      // TODO GLOAS: Post-gloas's blobKzgCommitments is not in beacon block body. Need to source it from somewhere else.
      // if block without columns is passed default to zero and throw below
      blobCount = 0;
    } else {
      blobCount = (block as SignedBeaconBlock<ForkPostFulu & ForkPreGloas>).message.body.blobKzgCommitments.length;
    }

    if (columnSidecars.length === 0) {
      if (!blobCount) {
        // no columns in the slot
        continue;
      }

      /**
       * If no columns are found for a block and there are commitments on the block then stop checking and just
       * return early. Even if there were columns returned for subsequent slots that doesn't matter because
       * we will be re-requesting them again anyway.  Leftovers just get ignored
       */
      warnings.push(
        new DownloadByRangeError({
          code: DownloadByRangeErrorCode.MISSING_COLUMNS,
          slot,
          blockRoot: rootHex,
          missingIndices: prettyPrintIndices(request.columns),
        })
      );
      break;
    }

    const returnedColumns = Array.from(columnSidecarsMap.keys()).sort();
    if (!blobCount) {
      // columns for a block that does not have blobs
      // TODO(fulu): should this be a hard error with no data retained from peer or just a warning
      throw new DownloadByRangeError(
        {
          code: DownloadByRangeErrorCode.NO_COLUMNS_FOR_BLOCK,
          slot,
          blockRoot: rootHex,
          invalidIndices: prettyPrintIndices(returnedColumns),
        },
        "Block has no blob commitments but data column sidecars were provided"
      );
    }

    const missingIndices = request.columns.filter((i) => !columnSidecarsMap.has(i));
    if (missingIndices.length > 0) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.MISSING_COLUMNS,
            slot,
            blockRoot: rootHex,
            missingIndices: prettyPrintIndices(missingIndices),
          },
          "Missing data columns in DataColumnSidecarsByRange response"
        )
      );
    }

    const extraIndices = returnedColumns.filter((i) => !request.columns.includes(i));
    if (extraIndices.length > 0) {
      warnings.push(
        new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.EXTRA_COLUMNS,
            slot,
            blockRoot: rootHex,
            invalidIndices: prettyPrintIndices(extraIndices),
          },
          "Data column in not in requested columns in DataColumnSidecarsByRange response"
        )
      );
    }

    validationPromises.push(
      validateBlockDataColumnSidecars(slot, blockRoot, blobCount, columnSidecars).then(() => ({
        blockRoot,
        columnSidecars,
      }))
    );
  }

  const validatedColumns = await Promise.all(validationPromises);
  return {
    result: validatedColumns,
    warnings: warnings.length ? warnings : null,
  };
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
  MISSING_BLOCKS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCK_RESPONSE",
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
  NO_COLUMNS_FOR_BLOCK = "DOWNLOAD_BY_RANGE_ERROR_NO_COLUMNS_FOR_BLOCK",
  DUPLICATE_COLUMN = "DOWNLOAD_BY_RANGE_ERROR_DUPLICATE_COLUMN",
  OUT_OF_ORDER_COLUMNS = "DOWNLOAD_BY_RANGE_OUT_OF_ORDER_COLUMNS",

  /** Cached block input type mismatches new data */
  MISMATCH_BLOCK_FORK = "DOWNLOAD_BY_RANGE_ERROR_MISMATCH_BLOCK_FORK",
  MISMATCH_BLOCK_INPUT_TYPE = "DOWNLOAD_BY_RANGE_ERROR_MISMATCH_BLOCK_INPUT_TYPE",
}

export type DownloadByRangeErrorType =
  | {
      code:
        | DownloadByRangeErrorCode.MISSING_BLOCKS_RESPONSE
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
      code: DownloadByRangeErrorCode.OUT_OF_RANGE_BLOCKS;
      slot: number;
    }
  | {
      code: DownloadByRangeErrorCode.MISMATCH_BLOCK_FORK;
      slot: number;
      dataFork: string;
      blockFork: string;
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
      code: DownloadByRangeErrorCode.OUT_OF_ORDER_BLOBS | DownloadByRangeErrorCode.OUT_OF_ORDER_COLUMNS;
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
      code: DownloadByRangeErrorCode.DUPLICATE_COLUMN;
      slot: Slot;
      index: number;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_COLUMNS | DownloadByRangeErrorCode.NO_COLUMNS_FOR_BLOCK;
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
