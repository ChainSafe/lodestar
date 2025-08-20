import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, NUMBER_OF_COLUMNS, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {BlobIndex, ColumnIndex, RootHex, SignedBeaconBlock, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlobSidecarInclusionProof, validateBlobsAndBlobProofs} from "../../chain/validation/blobSidecar.js";
import {
  verifyDataColumnSidecarInclusionProof,
  verifyDataColumnSidecarKzgProofs,
} from "../../chain/validation/dataColumnSidecar.js";
import {IExecutionEngine} from "../../execution/index.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {PeerIdStr} from "../../util/peerId.js";
import {BlobSidecarsByRootRequest} from "../../util/types.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "../types.js";

export type FetchByRootCoreProps = {
  config: ChainForkConfig;
  network: INetwork;
  peerIdStr: PeerIdStr;
};
export type FetchByRootProps = FetchByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
  executionEngine: IExecutionEngine;
  blockRoot: Uint8Array;
};
export type FetchByRootAndValidateBlockProps = FetchByRootCoreProps & {blockRoot: Uint8Array};
export type FetchByRootAndValidateBlobsProps = FetchByRootAndValidateBlockProps & {
  executionEngine: IExecutionEngine;
  blobIndices: BlobIndex[];
};
export type FetchByRootAndValidateColumnsProps = FetchByRootAndValidateBlockProps & {
  executionEngine: IExecutionEngine;
  columnIndices: ColumnIndex[];
};
export type FetchByRootResponses = {
  block: SignedBeaconBlock;
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export type DownloadByRootProps = FetchByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
  seenCache: SeenBlockInput;
  executionEngine: IExecutionEngine;
};
export async function downloadByRoot({
  config,
  seenCache,
  network,
  executionEngine,
  peerIdStr,
  cacheItem,
}: DownloadByRootProps): Promise<PendingBlockInput> {
  const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
  const blockRoot = fromHex(rootHex);

  const {block, blobSidecars, columnSidecars} = await fetchByRoot({
    config,
    network,
    executionEngine,
    cacheItem,
    blockRoot,
    peerIdStr,
  });

  let blockInput: IBlockInput;
  if (isPendingBlockInput(cacheItem)) {
    blockInput = cacheItem.blockInput;
    if (!blockInput.hasBlock()) {
      blockInput.addBlock({
        block,
        blockRootHex: rootHex,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      });
    }
  } else {
    blockInput = seenCache.getByBlock({
      block,
      peerIdStr,
      blockRootHex: rootHex,
      seenTimestampSec: Date.now(),
      source: BlockInputSource.byRoot,
    });
  }

  if (isBlockInputBlobs(blockInput)) {
    if (!blobSidecars) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_BLOB_RESPONSE,
        blockRoot: prettyBytes(rootHex),
        peer: peerIdStr,
      });
    }
    for (const blobSidecar of blobSidecars) {
      blockInput.addBlob({
        blobSidecar,
        blockRootHex: rootHex,
        seenTimestampSec: Date.now(),
        source: BlockInputSource.byRoot,
        peerIdStr,
      });
    }
  }

  if (isBlockInputColumns(blockInput)) {
    if (!columnSidecars) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE,
        blockRoot: prettyBytes(rootHex),
        peer: peerIdStr,
      });
    }
    for (const columnSidecar of columnSidecars) {
      blockInput.addColumn({
        columnSidecar,
        blockRootHex: rootHex,
        seenTimestampSec: Date.now(),
        source: BlockInputSource.byRoot,
        peerIdStr,
      });
    }
  }

  let status: PendingBlockInputStatus;
  let timeSyncedSec: number | undefined;
  if (blockInput.hasBlockAndAllData()) {
    status = PendingBlockInputStatus.downloaded;
    timeSyncedSec = Date.now() / 1000;
  } else {
    status = PendingBlockInputStatus.pending;
  }

  return {
    status,
    blockInput,
    timeSyncedSec,
    timeAddedSec: cacheItem.timeAddedSec,
    peerIdStrings: cacheItem.peerIdStrings,
  };
}

export async function fetchByRoot({
  config,
  network,
  executionEngine,
  peerIdStr,
  blockRoot,
  cacheItem,
}: FetchByRootProps): Promise<FetchByRootResponses> {
  let block: SignedBeaconBlock;
  let blobSidecars: deneb.BlobSidecars | undefined;
  let columnSidecars: fulu.DataColumnSidecars | undefined;

  if (isPendingBlockInput(cacheItem)) {
    if (cacheItem.blockInput.hasBlock()) {
      block = cacheItem.blockInput.getBlock();
    } else {
      block = await fetchAndValidateBlock({
        config,
        network,
        peerIdStr,
        blockRoot,
      });
    }

    if (!cacheItem.blockInput.hasAllData()) {
      if (isBlockInputBlobs(cacheItem.blockInput)) {
        blobSidecars = await fetchAndValidateBlobs({
          config,
          network,
          executionEngine,
          peerIdStr,
          blockRoot,
          blobIndices: cacheItem.blockInput.getMissingBlobMeta().map((b) => b.index),
        });
      }
      if (isBlockInputColumns(cacheItem.blockInput)) {
        columnSidecars = await fetchAndValidateColumns({
          config,
          network,
          executionEngine,
          peerIdStr,
          blockRoot,
          columnIndices: cacheItem.blockInput.getMissingSampledColumnMeta().map((c) => c.index),
        });
      }
    }
  } else {
    block = await fetchAndValidateBlock({
      config,
      network,
      peerIdStr,
      blockRoot,
    });
    const forkName = config.getForkName(block.message.slot);
    if (isForkPostFulu(forkName)) {
      columnSidecars = await fetchAndValidateColumns({
        config,
        network,
        executionEngine,
        peerIdStr,
        blockRoot,
        columnIndices: network.custodyConfig.sampledColumns,
      });
    } else if (isForkPostDeneb(forkName)) {
      const blobCount = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
      blobSidecars = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        peerIdStr,
        blockRoot,
        blobIndices: Array.from({length: blobCount}, (_, i) => i),
      });
    }
  }

  return {
    block,
    blobSidecars,
    columnSidecars,
  };
}

export async function fetchAndValidateBlock({
  config,
  network,
  peerIdStr,
  blockRoot,
}: FetchByRootAndValidateBlockProps): Promise<SignedBeaconBlock> {
  const response = await network.sendBeaconBlocksByRoot(peerIdStr, [blockRoot]);
  const block = response.at(0)?.data;
  if (!block) {
    throw new DownloadByRootError({
      code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE,
      peer: prettyPrintPeerIdStr(peerIdStr),
      blockRoot: prettyBytes(toRootHex(blockRoot)),
    });
  }
  const receivedRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  if (!byteArrayEquals(receivedRoot, blockRoot)) {
    throw new DownloadByRootError(
      {
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: prettyPrintPeerIdStr(peerIdStr),
        requestedBlockRoot: prettyBytes(toRootHex(blockRoot)),
        receivedBlockRoot: prettyBytes(toRootHex(receivedRoot)),
      },
      "block does not match requested root"
    );
  }
  return block;
}

export async function fetchAndValidateBlobs({
  config,
  network,
  // executionEngine,
  peerIdStr,
  blockRoot,
  blobIndices,
}: FetchByRootAndValidateBlobsProps): Promise<deneb.BlobSidecars> {
  const blobsRequest = blobIndices.map((index) => ({blockRoot, index}));
  const blobSidecars = await network.sendBlobSidecarsByRoot(peerIdStr, blobsRequest);

  for (const blobSidecar of blobSidecars) {
    if (!blobIndices.includes(blobSidecar.index)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: prettyBytes(toRootHex(blockRoot)),
          invalidIndex: blobSidecar.index,
        },
        "received a blobSidecar that was not requested"
      );
    }
    const headerRoot = config
      .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
    if (byteArrayEquals(blockRoot, headerRoot)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
          peer: prettyPrintPeerIdStr(peerIdStr),
          requestedBlockRoot: prettyBytes(toRootHex(blockRoot)),
          receivedBlockRoot: prettyBytes(toRootHex(headerRoot)),
        },
        `blobSidecar.signedBlockHeader not match requested blockRoot for index=${blobSidecar.index}`
      );
    }

    if (!validateBlobSidecarInclusionProof(blobSidecar)) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
        peer: prettyPrintPeerIdStr(peerIdStr),
        blockRoot: prettyBytes(toRootHex(blockRoot)),
        sidecarIndex: blobSidecar.index,
      });
    }
  }

  try {
    await validateBlobsAndBlobProofs(
      blobSidecars.map((b) => b.kzgCommitment),
      blobSidecars.map((b) => b.blob),
      blobSidecars.map((b) => b.kzgProof)
    );
  } catch {
    throw new DownloadByRootError({
      code: DownloadByRootErrorCode.INVALID_KZG_PROOF,
      peer: prettyPrintPeerIdStr(peerIdStr),
      blockRoot: prettyBytes(toRootHex(blockRoot)),
    });
  }

  return blobSidecars;
}

export async function fetchAndValidateColumns({
  config,
  network,
  // executionEngine,
  peerIdStr,
  blockRoot,
  columnIndices,
}: FetchByRootAndValidateColumnsProps): Promise<fulu.DataColumnSidecars> {
  const columnSidecars = await network.sendDataColumnSidecarsByRoot(peerIdStr, [{blockRoot, columns: columnIndices}]);

  for (const columnSidecar of columnSidecars) {
    if (!columnIndices.includes(columnSidecar.index)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: prettyBytes(toRootHex(blockRoot)),
          invalidIndex: columnSidecar.index,
        },
        "received a columnSidecar that was not requested"
      );
    }

    const headerRoot = config
      .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
    if (byteArrayEquals(blockRoot, headerRoot)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
          peer: prettyPrintPeerIdStr(peerIdStr),
          requestedBlockRoot: prettyBytes(toRootHex(blockRoot)),
          receivedBlockRoot: prettyBytes(toRootHex(headerRoot)),
        },
        `columnSidecar.signedBlockHeader not match requested blockRoot for index=${columnSidecar.index}`
      );
    }

    if (!verifyDataColumnSidecarInclusionProof(columnSidecar)) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
        peer: prettyPrintPeerIdStr(peerIdStr),
        blockRoot: prettyBytes(toRootHex(blockRoot)),
        sidecarIndex: columnSidecar.index,
      });
    }
  }

  try {
    // TODO(fulu): need to double check that the construction of these arrays is correct
    await verifyDataColumnSidecarKzgProofs(
      columnSidecars.flatMap((c) => c.kzgCommitments),
      columnSidecars.flatMap((c) => Array.from({length: c.column.length}, () => c.index)),
      columnSidecars.flatMap((c) => c.column),
      columnSidecars.flatMap((c) => c.kzgProofs)
    );
  } catch {
    throw new DownloadByRootError({
      code: DownloadByRootErrorCode.INVALID_KZG_PROOF,
      peer: prettyPrintPeerIdStr(peerIdStr),
      blockRoot: prettyBytes(toRootHex(blockRoot)),
    });
  }

  return columnSidecars;
}

export enum DownloadByRootErrorCode {
  MISMATCH_BLOCK_ROOT = "DOWNLOAD_BY_ROOT_ERROR_MISMATCH_BLOCK_ROOT",
  EXTRA_SIDECAR_RECEIVED = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_SIDECAR_RECEIVED",
  INVALID_INCLUSION_PROOF = "DOWNLOAD_BY_ROOT_ERROR_INVALID_INCLUSION_PROOF",
  INVALID_KZG_PROOF = "DOWNLOAD_BY_ROOT_ERROR_INVALID_KZG_PROOF",
  MISSING_BLOCK_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOCK_RESPONSE",
  MISSING_BLOB_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOB_RESPONSE",
  MISSING_COLUMN_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_COLUMN_RESPONSE",
  Z = "DOWNLOAD_BY_ROOT_ERROR_Z",
}
export type DownloadByRootErrorType =
  | {
      code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT;
      peer: string;
      requestedBlockRoot: string;
      receivedBlockRoot: string;
    }
  | {
      code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED;
      peer: string;
      blockRoot: string;
      invalidIndex: number;
    }
  | {
      code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF;
      peer: string;
      blockRoot: string;
      sidecarIndex: number;
    }
  | {
      code: DownloadByRootErrorCode.INVALID_KZG_PROOF;
      peer: string;
      blockRoot: string;
    }
  | {
      code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE;
      peer: string;
      blockRoot: string;
    }
  | {
      code: DownloadByRootErrorCode.MISSING_BLOB_RESPONSE;
      peer: string;
      blockRoot: string;
    }
  | {
      code: DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE;
      peer: string;
      blockRoot: string;
    };

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
