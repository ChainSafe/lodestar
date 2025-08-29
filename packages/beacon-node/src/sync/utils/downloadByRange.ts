import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {SignedBeaconBlock, Slot, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, Logger, fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {
  BlockInputSource,
  DAType,
  IBlockInput,
  isBlockInputBlobs,
  isBlockInputColumns,
} from "../../chain/blocks/blockInput/index.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlobSidecarInclusionProof, validateBlobsAndBlobProofs} from "../../chain/validation/blobSidecar.js";
import {
  verifyDataColumnSidecar,
  verifyDataColumnSidecarInclusionProof,
} from "../../chain/validation/dataColumnSidecar.js";
import {INetwork} from "../../network/index.js";
import {PeerIdStr} from "../../util/peerId.js";
import {RangeSyncType} from "./remoteSyncType.js";

/**
 *
 * blocks
 * - check all slots are within range of startSlot (inclusive) through startSlot + count (exclusive)
 * - don't have more than count number of blocks
 * - slots are in ascending order
 * - must allow for skip slots
 * - check is a chain of blocks where via parentRoot matches hashTreeRoot of block before
 *
 * blobs
 * - check that expected sidecar count matches the returned count
 * - slots are in ascending order
 * - allows for skip slots in validation
 * - indices are in ascending order
 * - check that the number of blobCount for a slot matches block.message.body.blobKzgCommitments.length
 * - check that blobSidecar.kzgCommitment matches block.message.body.blobKzgCommitments[blobSidecar.index]
 * - hashTreeRoot(block.message) equals the hashTreeRoot(blobSidecar.signedBlockHeader.message)
 * - verify_blob_sidecar, verify_kzg_inclusion_proof, verify_kzg_proof (spec verification)
 *
 *
 * Clients MUST respond with at least the blob sidecars of the first blob-carrying block that exists
 * in the range, if they have it, and no more than MAX_REQUEST_BLOB_SIDECARS sidecars.
 *
 * Clients MUST include all blob sidecars of each block from which they include blob sidecars.
 *
 * The following blob sidecars, where they exist, MUST be sent in consecutive (slot, index) order.
 *
 *
 *
 *
 *
 *
 *
 * columns
 * - check that expected sidecar count matches the returned count (discount slots with 0 blobKzgCommitment.length)
 * - slots are in ascending order
 * - indices are in ascending order
 * - check that blobCount = 0 in a slot (come back to this)
 * - verify_blob_sidecar, verify_kzg_inclusion_proof, verify_kzg_proof
 */

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

  const blockRoots = await validateResponses({
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
  }): Promise<Uint8Array[]> {
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

  const blockRoots = blocksRequest ? validateBlockByRangeResponse(config, blocksRequest, blocks ?? []) : [];

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

    const startSlot = blobsRequest.startSlot;
    const endSlot = startSlot + blobsRequest.count;

    // Organize pre-fetched blocks and the blocks received in this response, only including those in the requested slot range
    const blobsRequestBlocks: SignedBeaconBlock[] = [];
    const blobsRequestBlockRoots: Uint8Array[] = [];
    let lastSlot = startSlot - 1;
    if (batchBlocks) {
      for (let i = 0; i < batchBlocks.length; i++) {
        const blockInput = batchBlocks[i];
        if (blockInput.slot >= startSlot && blockInput.slot < endSlot && blockInput.slot > lastSlot) {
          blobsRequestBlocks.push(blockInput.getBlock());
          blobsRequestBlockRoots.push(fromHex(blockInput.blockRootHex));
          lastSlot = blockInput.slot;
        }
      }
    }
    if (blocks) {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.message.slot >= startSlot && block.message.slot < endSlot && block.message.slot > lastSlot) {
          blobsRequestBlocks.push(block);
          blobsRequestBlockRoots.push(blockRoots[i]);
          lastSlot = block.message.slot;
        }
      }
    }

    await validateBlobsByRangeResponse(config, blobsRequestBlocks, blobsRequestBlockRoots, blobSidecars);
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

    const startSlot = columnsRequest.startSlot;
    const endSlot = startSlot + columnsRequest.count;

    // Organize pre-fetched blocks and the blocks received in this response, only including those in the requested slot range
    // (logic copy pasted from blobsRequest validation above)
    const columnsRequestBlocks: SignedBeaconBlock[] = [];
    const columnsRequestBlockRoots: Uint8Array[] = [];
    let lastSlot = startSlot - 1;
    if (batchBlocks) {
      for (let i = 0; i < batchBlocks.length; i++) {
        const blockInput = batchBlocks[i];
        if (blockInput.slot >= startSlot && blockInput.slot < endSlot && blockInput.slot > lastSlot) {
          columnsRequestBlocks.push(blockInput.getBlock());
          columnsRequestBlockRoots.push(fromHex(blockInput.blockRootHex));
          lastSlot = blockInput.slot;
        }
      }
    }
    if (blocks) {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.message.slot >= startSlot && block.message.slot < endSlot && block.message.slot > lastSlot) {
          columnsRequestBlocks.push(block);
          columnsRequestBlockRoots.push(blockRoots[i]);
          lastSlot = block.message.slot;
        }
      }
    }

    await validateColumnsByRangeResponse(
      config,
      columnsRequest,
      columnsRequestBlocks,
      columnsRequestBlockRoots,
      columnSidecars
    );
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
export async function validateBlobsByRangeResponse(
  config: ChainForkConfig,
  requestBlocks: SignedBeaconBlock[],
  requestBlockRoots: Uint8Array[],
  blobSidecars: deneb.BlobSidecars
): Promise<void> {
  const expectedBlobCount = requestBlocks.reduce(
    (acc, block) => (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length + acc,
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

  // First loop to do cheap validation before expensive proof and blob validation below
  // Check block roots, indices match expected blocks
  for (let blockIndex = 0, blobSidecarIndex = 0; blockIndex < requestBlocks.length; blockIndex++) {
    const block = requestBlocks[blockIndex];
    const expectedBlobs = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
    for (let i = 0; i < expectedBlobs; i++, blobSidecarIndex++) {
      const blobSidecar = blobSidecars[blobSidecarIndex];
      const blockRoot = config
        .getForkTypes(block.message.slot)
        .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
      const slot = block.message.slot;
      if (Buffer.compare(requestBlockRoots[blockIndex], blockRoot) !== 0) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.WRONG_BLOCK_BLOBS,
            expected: toRootHex(requestBlockRoots[blockIndex]),
            actual: toRootHex(blockRoot),
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

  // Second loop to do more expensive validation after cheap checks above
  for (let blockIndex = 0, blobSidecarIndex = 0; blockIndex < requestBlocks.length; blockIndex++) {
    const block = requestBlocks[blockIndex];
    const expectedKzgCommitments = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments;
    const blobs = [];
    const proofs = [];
    for (let i = 0; i < expectedKzgCommitments.length; i++, blobSidecarIndex++) {
      const blobSidecar = blobSidecars[blobSidecarIndex];
      validateBlobSidecarInclusionProof(blobSidecar);
      blobs.push(blobSidecar.blob);
      proofs.push(blobSidecar.kzgProof);
    }
    await validateBlobsAndBlobProofs(expectedKzgCommitments, blobs, proofs);
  }
}

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
export async function validateColumnsByRangeResponse(
  config: ChainForkConfig,
  request: fulu.DataColumnSidecarsByRangeRequest,
  requestBlocks: SignedBeaconBlock[],
  requestBlockRoots: Uint8Array[],
  columnSidecars: fulu.DataColumnSidecars
): Promise<void> {
  const expectedColumnCount = requestBlocks.reduce((acc, block) => {
    return (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length > 0
      ? request.columns.length + acc
      : acc;
  }, 0);
  if (columnSidecars.length > expectedColumnCount) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.EXTRA_COLUMNS,
        expected: expectedColumnCount,
        actual: columnSidecars.length,
      },
      "Extra data columns received in DataColumnSidecarsByRange response"
    );
  }
  if (columnSidecars.length < expectedColumnCount) {
    throw new DownloadByRangeError(
      {
        code: DownloadByRangeErrorCode.MISSING_COLUMNS,
        expected: expectedColumnCount,
        actual: columnSidecars.length,
      },
      "Missing data columns in DataColumnSidecarsByRange response"
    );
  }
  // First loop to do cheap validation before expensive proof validation below
  // Check block roots, indices match expected blocks
  for (let blockIndex = 0, columnSidecarIndex = 0; blockIndex < requestBlocks.length; blockIndex++) {
    const block = requestBlocks[blockIndex];
    const expectedColumns = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length
      ? request.columns.length
      : 0;
    for (let i = 0; i < expectedColumns; i++, columnSidecarIndex++) {
      const columnIndex = request.columns[i];
      const columnSidecar = columnSidecars[columnSidecarIndex];
      const blockRoot = config
        .getForkTypes(block.message.slot)
        .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
      const slot = block.message.slot;
      if (Buffer.compare(requestBlockRoots[blockIndex], blockRoot) !== 0) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.WRONG_BLOCK_COLUMNS,
            expected: toRootHex(requestBlockRoots[blockIndex]),
            actual: toRootHex(blockRoot),
          },
          "DataColumnSidecar doesn't match corresponding block in DataColumnSidecarsByRange response"
        );
      }
      if (columnSidecar.index !== columnIndex) {
        throw new DownloadByRangeError(
          {
            code: DownloadByRangeErrorCode.WRONG_INDEX_COLUMNS,
            slot,
            expected: columnIndex,
            actual: columnSidecar.index,
          },
          "DataColumnSidecar out of order in DataColumnSidecarsByRange response"
        );
      }
    }
  }

  // Second loop to do more expensive validation after cheap checks above
  for (let blockIndex = 0, columnSidecarIndex = 0; blockIndex < requestBlocks.length; blockIndex++) {
    const block = requestBlocks[blockIndex];
    const expectedColumns = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length
      ? request.columns.length
      : 0;
    for (let i = 0; i < expectedColumns; i++, columnSidecarIndex++) {
      const columnSidecar = columnSidecars[columnSidecarIndex];
      verifyDataColumnSidecar(columnSidecar);
      // await verifyDataColumnSidecarKzgProofs(...);
      verifyDataColumnSidecarInclusionProof(columnSidecar);
    }
  }
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
  WRONG_BLOCK_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_BLOCK_BLOBS",
  WRONG_INDEX_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_INDEX_BLOBS",
  DUPLICATE_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_DUPLICATE_BLOBS",
  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",
  EXTRA_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_EXTRA_COLUMNS",
  WRONG_BLOCK_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_BLOCK_COLUMNS",
  WRONG_INDEX_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_WRONG_INDEX_COLUMNS",
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
      code: DownloadByRangeErrorCode.WRONG_BLOCK_BLOBS;
      expected: string;
      actual: string;
    }
  | {
      code: DownloadByRangeErrorCode.WRONG_INDEX_BLOBS;
      slot: number;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_COLUMNS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.EXTRA_COLUMNS;
      expected: number;
      actual: number;
    }
  | {
      code: DownloadByRangeErrorCode.WRONG_BLOCK_COLUMNS;
      expected: string;
      actual: string;
    }
  | {
      code: DownloadByRangeErrorCode.WRONG_INDEX_COLUMNS;
      slot: number;
      expected: number;
      actual: number;
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
