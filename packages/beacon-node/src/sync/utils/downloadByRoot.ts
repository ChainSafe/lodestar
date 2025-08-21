import {ChainForkConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostDeneb,
  ForkPostFulu,
  ForkPreFulu,
  NUMBER_OF_COLUMNS,
  isForkPostDeneb,
  isForkPostFulu,
} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {BlobIndex, ColumnIndex, RootHex, SignedBeaconBlock, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlobMeta, BlockInputSource, IBlockInput, MissingColumnMeta} from "../../chain/blocks/blockInput/types.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlobSidecarInclusionProof, validateBlobsAndBlobProofs} from "../../chain/validation/blobSidecar.js";
import {
  verifyDataColumnSidecarInclusionProof,
  verifyDataColumnSidecarKzgProofs,
} from "../../chain/validation/dataColumnSidecar.js";
import {IExecutionEngine} from "../../execution/index.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {computeInclusionProof, kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {getCellsAndProofs, getDataColumnSidecarsFromBlock} from "../../util/dataColumns.js";
import {kzg} from "../../util/kzg.js";
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
  forkName: ForkPreFulu;
  block: SignedBeaconBlock<ForkPostDeneb>;
  blobMeta: BlobMeta[];
};
export type FetchByRootAndValidateColumnsProps = FetchByRootAndValidateBlockProps & {
  executionEngine: IExecutionEngine;
  forkName: ForkPostFulu;
  block: SignedBeaconBlock<ForkPostFulu>;
  columnMeta: MissingColumnMeta;
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

    const forkName = config.getForkName(block.message.slot);
    if (!cacheItem.blockInput.hasAllData()) {
      if (isBlockInputBlobs(cacheItem.blockInput)) {
        blobSidecars = await fetchAndValidateBlobs({
          config,
          network,
          executionEngine,
          peerIdStr,
          forkName: forkName as ForkPreFulu,
          block: block as SignedBeaconBlock<ForkPostDeneb>,
          blockRoot,
          blobMeta: cacheItem.blockInput.getMissingBlobMeta(),
        });
      }
      if (isBlockInputColumns(cacheItem.blockInput)) {
        columnSidecars = await fetchAndValidateColumns({
          config,
          network,
          executionEngine,
          peerIdStr,
          forkName: forkName as ForkPostFulu,
          block: block as SignedBeaconBlock<ForkPostFulu>,
          blockRoot,
          columnMeta: cacheItem.blockInput.getMissingSampledColumnMeta(),
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
        forkName,
        blockRoot,
        block: block as SignedBeaconBlock<ForkPostFulu>,
        columnMeta: {
          missing: network.custodyConfig.sampledColumns,
          versionedHashes: (block as SignedBeaconBlock<ForkPostFulu>).message.body.blobKzgCommitments.map((c) =>
            kzgCommitmentToVersionedHash(c)
          ),
        },
      });
    } else if (isForkPostDeneb(forkName)) {
      const commitments = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments;
      const blobCount = commitments.length;
      blobSidecars = await fetchAndValidateBlobs({
        config,
        network,
        executionEngine,
        peerIdStr,
        forkName: forkName as ForkPreFulu,
        blockRoot,
        block: block as SignedBeaconBlock<ForkPostDeneb>,
        blobMeta: Array.from({length: blobCount}, (_, i) => ({
          index: i,
          blockRoot,
          versionedHash: kzgCommitmentToVersionedHash(commitments[i]),
        })),
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
      blockRoot: prettyBytes(blockRoot),
    });
  }
  const receivedRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
  if (!byteArrayEquals(receivedRoot, blockRoot)) {
    throw new DownloadByRootError(
      {
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: prettyPrintPeerIdStr(peerIdStr),
        requestedBlockRoot: prettyBytes(blockRoot),
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
  executionEngine,
  forkName,
  peerIdStr,
  blockRoot,
  block,
  blobMeta,
}: FetchByRootAndValidateBlobsProps): Promise<deneb.BlobSidecars> {
  const blobSidecars = await fetchGetBlobsV1AndBuildSidecars({
    config,
    executionEngine,
    forkName,
    block,
    blobMeta,
  });

  // not all needed blobs were fetched via getBlobs, need to use ReqResp
  if (blobSidecars.length !== blobMeta.length) {
    const networkResponse = await fetchBlobByRoot({
      network,
      peerIdStr,
      blockRoot,
      blobMeta,
      indicesInPossession: blobSidecars.map((b) => b.index),
    });
    blobSidecars.push(...networkResponse);
  }

  await validateBlobs({config, peerIdStr, blockRoot, blobMeta, blobSidecars});

  return blobSidecars;
}

export async function fetchGetBlobsV1AndBuildSidecars({
  config,
  executionEngine,
  forkName,
  block,
  blobMeta,
}: Pick<
  FetchByRootAndValidateBlobsProps,
  "config" | "executionEngine" | "forkName" | "block" | "blobMeta"
>): Promise<deneb.BlobSidecars> {
  const blobSidecars: deneb.BlobSidecars = [];

  const enginedResponse = await executionEngine.getBlobs(
    forkName,
    blobMeta.map(({versionedHash: versionHash}) => versionHash)
  );

  if (enginedResponse.length > 0) {
    // response.length should always match blobMeta.length and they should be in the same order
    for (let i = 0; i < blobMeta.length; i++) {
      const blobAndProof = enginedResponse[i];
      if (blobAndProof) {
        const {blob, proof} = blobAndProof;
        const index = blobMeta[i].index;
        const kzgCommitment = block.message.body.blobKzgCommitments[i];
        const sidecar: deneb.BlobSidecar = {
          index,
          blob,
          kzgProof: proof,
          kzgCommitment,
          kzgCommitmentInclusionProof: computeInclusionProof(forkName, block.message.body, index),
          signedBlockHeader: signedBlockToSignedHeader(config, block),
        };
        blobSidecars.push(sidecar);
      }
    }
  }

  return blobSidecars;
}

export async function fetchBlobByRoot({
  network,
  peerIdStr,
  blockRoot,
  blobMeta,
  indicesInPossession,
}: Pick<FetchByRootAndValidateBlobsProps, "network" | "peerIdStr" | "blockRoot" | "blobMeta"> & {
  indicesInPossession: number[];
}): Promise<deneb.BlobSidecars> {
  const blobsRequest = blobMeta
    .filter(({index}) => !indicesInPossession.includes(index))
    .map(({index}) => ({blockRoot, index}));
  return await network.sendBlobSidecarsByRoot(peerIdStr, blobsRequest);
}

export async function validateBlobs({
  config,
  blockRoot,
  peerIdStr,
  blobMeta,
  blobSidecars,
}: Pick<FetchByRootAndValidateBlobsProps, "config" | "blobMeta" | "peerIdStr" | "blockRoot"> & {
  blobSidecars: deneb.BlobSidecars;
}): Promise<void> {
  const requestedIndices = blobMeta.map((b) => b.index);
  for (const blobSidecar of blobSidecars) {
    if (!requestedIndices.includes(blobSidecar.index)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: prettyBytes(blockRoot),
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
          requestedBlockRoot: prettyBytes(blockRoot),
          receivedBlockRoot: prettyBytes(toRootHex(headerRoot)),
        },
        `blobSidecar.signedBlockHeader not match requested blockRoot for index=${blobSidecar.index}`
      );
    }

    if (!validateBlobSidecarInclusionProof(blobSidecar)) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
        peer: prettyPrintPeerIdStr(peerIdStr),
        blockRoot: prettyBytes(blockRoot),
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
      blockRoot: prettyBytes(blockRoot),
    });
  }
}

export async function fetchGetBlobsV2AndBuildSidecars({
  config,
  executionEngine,
  forkName,
  block,
  columnMeta,
}: Pick<
  FetchByRootAndValidateColumnsProps,
  "config" | "executionEngine" | "forkName" | "block" | "columnMeta"
>): Promise<fulu.DataColumnSidecars> {
  const response = await executionEngine.getBlobs(forkName, columnMeta.versionedHashes);
  if (!response) {
    return [];
  }

  const cellsAndProofs = await getCellsAndProofs(response);
  return getDataColumnSidecarsFromBlock(config, block, cellsAndProofs);
}

export async function fetchColumnsByRoot({
  network,
  peerIdStr,
  blockRoot,
  columnMeta,
}: FetchByRootAndValidateColumnsProps): Promise<fulu.DataColumnSidecars> {
  return await network.sendDataColumnSidecarsByRoot(peerIdStr, [{blockRoot, columns: columnMeta.missing}]);
}

export function validateColumnSidecar({
  config,
  peerIdStr,
  blockRoot,
  columnSidecar,
}: Pick<FetchByRootAndValidateColumnsProps, "config" | "peerIdStr" | "blockRoot"> & {
  columnSidecar: fulu.DataColumnSidecar;
}): void {
  const headerRoot = config
    .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
    .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
  if (byteArrayEquals(blockRoot, headerRoot)) {
    throw new DownloadByRootError(
      {
        code: DownloadByRootErrorCode.MISMATCH_BLOCK_ROOT,
        peer: prettyPrintPeerIdStr(peerIdStr),
        requestedBlockRoot: prettyBytes(blockRoot),
        receivedBlockRoot: prettyBytes(toRootHex(headerRoot)),
      },
      `columnSidecar.signedBlockHeader not match requested blockRoot for index=${columnSidecar.index}`
    );
  }

  if (!verifyDataColumnSidecarInclusionProof(columnSidecar)) {
    throw new DownloadByRootError({
      code: DownloadByRootErrorCode.INVALID_INCLUSION_PROOF,
      peer: prettyPrintPeerIdStr(peerIdStr),
      blockRoot: prettyBytes(blockRoot),
      sidecarIndex: columnSidecar.index,
    });
  }
}

export async function validateColumnSidecars({
  config,
  peerIdStr,
  blockRoot,
  columnMeta,
  needed,
  needToPublish = [],
}: Pick<FetchByRootAndValidateColumnsProps, "config" | "peerIdStr" | "blockRoot" | "columnMeta"> & {
  needed: fulu.DataColumnSidecars;
  needToPublish?: fulu.DataColumnSidecars;
}): Promise<void> {
  const requestedIndices = columnMeta.missing;
  for (const columnSidecar of needed) {
    if (!requestedIndices.includes(columnSidecar.index)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: prettyBytes(blockRoot),
          invalidIndex: columnSidecar.index,
        },
        "received a columnSidecar that was not requested"
      );
    }

    validateColumnSidecar({
      config,
      peerIdStr,
      blockRoot,
      columnSidecar,
    });
  }

  const checkedIndices = needed.map((c) => c.index);
  const needToCheckProof: fulu.DataColumnSidecars = [];
  for (const columnSidecar of needToPublish) {
    if (!checkedIndices.includes(columnSidecar.index)) {
      validateColumnSidecar({
        config,
        peerIdStr,
        blockRoot,
        columnSidecar,
      });
      needToCheckProof.push(columnSidecar);
    }
  }

  const columnSidecars = [...needed, ...needToCheckProof];
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
      blockRoot: prettyBytes(blockRoot),
    });
  }
}

export async function fetchAndValidateColumns({
  config,
  network,
  executionEngine,
  forkName,
  peerIdStr,
  block,
  blockRoot,
  columnMeta,
}: FetchByRootAndValidateColumnsProps): Promise<fulu.DataColumnSidecars> {
  let columnSidecars = await fetchGetBlobsV2AndBuildSidecars({
    config,
    executionEngine,
    forkName,
    block,
    columnMeta,
  });

  if (columnSidecars.length) {
    // limit reconstructed to only the ones we need
    const needed = columnSidecars.filter((c) => columnMeta.missing.includes(c.index));
    // spec states that reconstructed sidecars need to be published to the network, but only requires
    // publishing the ones that we custody and have not already been published.
    const alreadyPublished = network.custodyConfig.custodyColumns.filter(
      (index) => !columnMeta.missing.includes(index)
    );
    const needToPublish = columnSidecars.filter(
      (c) => network.custodyConfig.custodyColumns.includes(c.index) && !alreadyPublished.includes(c.index)
    );
    // need to validate the ones we sample and will process
    await validateColumnSidecars({
      config,
      peerIdStr,
      blockRoot,
      columnMeta,
      needed,
      needToPublish,
    });
    needToPublish.map((column) =>
      network.publishDataColumnSidecar(column).catch((err) =>
        network.logger.error(
          "Error publishing column after getBlobsV2 reconstruct",
          {
            index: column.index,
            blockRoot: prettyBytes(blockRoot),
          },
          err
        )
      )
    );
    return needed;
  }

  columnSidecars = await network.sendDataColumnSidecarsByRoot(peerIdStr, [{blockRoot, columns: columnMeta.missing}]);
  await validateColumnSidecars({
    config,
    peerIdStr,
    blockRoot,
    columnMeta,
    needed: columnSidecars,
  });

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
