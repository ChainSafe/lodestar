import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, ForkPostFulu, ForkPreFulu, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {SignedBeaconBlock, deneb, fulu} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlobMeta, BlockInputSource, IBlockInput, MissingColumnMeta} from "../../chain/blocks/blockInput/types.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlockBlobSidecars} from "../../chain/validation/blobSidecar.js";
import {validateBlockDataColumnSidecars} from "../../chain/validation/dataColumnSidecar.js";
import {IExecutionEngine} from "../../execution/index.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {computePreFuluKzgCommitmentsInclusionProof, kzgCommitmentToVersionedHash} from "../../util/blobs.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {getCellsAndProofs, getDataColumnSidecarsFromBlock} from "../../util/dataColumns.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "../types.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {PeerIdStr} from "../../util/peerId.js";

export type FetchByRootCoreProps = {
  config: ChainForkConfig;
  network: INetwork;
  peerMeta: PeerSyncMeta;
};
export type FetchByRootProps = FetchByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
  executionEngine: IExecutionEngine;
  blockRoot: Uint8Array;
};
export type FetchByRootAndValidateBlockProps = Omit<FetchByRootCoreProps, "peerMeta"> & {
  peerIdStr: PeerIdStr;
  blockRoot: Uint8Array;
};
export type FetchByRootAndValidateBlobsProps = FetchByRootAndValidateBlockProps & {
  executionEngine: IExecutionEngine;
  forkName: ForkPreFulu;
  block: SignedBeaconBlock<ForkPostDeneb>;
  blobMeta: BlobMeta[];
};
export type FetchByRootAndValidateColumnsProps = FetchByRootCoreProps & {
  blockRoot: Uint8Array;
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
  peerMeta,
  cacheItem,
}: DownloadByRootProps): Promise<PendingBlockInput> {
  const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
  const blockRoot = fromHex(rootHex);
  const {peerId: peerIdStr} = peerMeta;

  const {block, blobSidecars, columnSidecars} = await fetchByRoot({
    config,
    network,
    executionEngine,
    cacheItem,
    blockRoot,
    peerMeta,
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

  const hasAllData = blockInput.hasBlockAndAllData();

  if (isBlockInputBlobs(blockInput) && !hasAllData) {
    // blobSidecars could be undefined if gossip resulted in full block+blobs so we don't download any
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

  if (isBlockInputColumns(blockInput) && !hasAllData) {
    // columnSidecars could be undefined if gossip resulted in full block+columns so we don't download any
    if (!columnSidecars) {
      throw new DownloadByRootError({
        code: DownloadByRootErrorCode.MISSING_COLUMN_RESPONSE,
        blockRoot: prettyBytes(rootHex),
        peer: peerIdStr,
      });
    }
    for (const columnSidecar of columnSidecars) {
      blockInput.addColumn(
        {
          columnSidecar,
          blockRootHex: rootHex,
          seenTimestampSec: Date.now(),
          source: BlockInputSource.byRoot,
          peerIdStr,
        },
        // the same DataColumnSidecar may be added by gossip while waiting for fetchByRoot
        {throwOnDuplicateAdd: false}
      );
    }
  }

  let status: PendingBlockInputStatus;
  let timeSyncedSec: number | undefined;
  if (hasAllData) {
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
  peerMeta,
  blockRoot,
  cacheItem,
}: FetchByRootProps): Promise<FetchByRootResponses> {
  let block: SignedBeaconBlock;
  let blobSidecars: deneb.BlobSidecars | undefined;
  let columnSidecars: fulu.DataColumnSidecars | undefined;
  const {peerId: peerIdStr} = peerMeta;

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
          peerMeta,
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
        peerMeta,
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
  let blobSidecars: deneb.BlobSidecars = [];
  try {
    blobSidecars = await fetchGetBlobsV1AndBuildSidecars({
      config,
      executionEngine,
      forkName,
      block,
      blobMeta,
    });
  } catch (err) {
    network.logger.error(
      `error fetching/building blobSidecars for blockRoot=${prettyBytes(blockRoot)} via getBlobsV1`,
      {},
      err as Error
    );
  }

  // not all needed blobs were fetched via getBlobs, need to use ReqResp
  if (blobSidecars.length !== blobMeta.length) {
    const networkResponse = await fetchBlobsByRoot({
      network,
      peerIdStr,
      blobMeta,
      indicesInPossession: blobSidecars.map((b) => b.index),
    });
    blobSidecars.push(...networkResponse);
  }

  // responses can be sparse for both types of requests to sort to make sure its in sequential order
  blobSidecars.sort((a, b) => a.index - b.index);

  await validateBlockBlobSidecars(block.message.slot, blockRoot, blobMeta.length, blobSidecars);

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
    blobMeta.map(({versionedHash}) => versionedHash)
  );

  if (!enginedResponse.length) {
    return blobSidecars;
  }

  // response.length should always match blobMeta.length and they should be in the same order
  for (let i = 0; i < blobMeta.length; i++) {
    const blobAndProof = enginedResponse[i];
    if (blobAndProof) {
      const {blob, proof} = blobAndProof;
      const index = blobMeta[i].index;
      const kzgCommitment = block.message.body.blobKzgCommitments[index];
      const sidecar: deneb.BlobSidecar = {
        index,
        blob,
        kzgProof: proof,
        kzgCommitment,
        // TODO(fulu): refactor this to only calculate the root inside these following two functions once
        kzgCommitmentInclusionProof: computePreFuluKzgCommitmentsInclusionProof(forkName, block.message.body, index),
        signedBlockHeader: signedBlockToSignedHeader(config, block),
      };
      blobSidecars.push(sidecar);
    }
  }

  return blobSidecars;
}

export async function fetchBlobsByRoot({
  network,
  peerIdStr,
  blobMeta,
  indicesInPossession = [],
}: Pick<FetchByRootAndValidateBlobsProps, "network" | "peerIdStr" | "blobMeta"> & {
  indicesInPossession?: number[];
}): Promise<deneb.BlobSidecars> {
  const blobsRequest = blobMeta
    .filter(({index}) => !indicesInPossession.includes(index))
    .map(({blockRoot, index}) => ({blockRoot, index}));
  if (!blobsRequest.length) {
    return [];
  }
  return await network.sendBlobSidecarsByRoot(peerIdStr, blobsRequest);
}

export async function fetchAndValidateColumns({
  config,
  network,
  executionEngine,
  forkName,
  peerMeta,
  block,
  blockRoot,
  columnMeta,
}: FetchByRootAndValidateColumnsProps): Promise<fulu.DataColumnSidecars> {
  const {peerId: peerIdStr} = peerMeta;
  const slot = block.message.slot;
  const blobCount = block.message.body.blobKzgCommitments.length;
  if (blobCount === 0) {
    return [];
  }

  const blobsV2ColumnSidecars = await fetchGetBlobsV2AndBuildSidecars({
    config,
    executionEngine,
    forkName,
    block,
    columnMeta,
  }).catch((err) => {
    network.logger.error(
      "error building columnSidecars via getBlobsV2",
      {slot, blockRoot: prettyBytes(blockRoot)},
      err as Error
    );
    return null;
  });
  if (blobsV2ColumnSidecars?.length) {
    // limit reconstructed to only the ones we need
    const needed = blobsV2ColumnSidecars.filter((c) => columnMeta.missing.includes(c.index));
    // spec states that reconstructed sidecars need to be published to the network, but only requires
    // publishing the ones that we custody and have not already been published.
    const alreadyPublished = network.custodyConfig.custodyColumns.filter(
      (index) => !columnMeta.missing.includes(index)
    );
    const needToPublish = blobsV2ColumnSidecars.filter(
      (c) => network.custodyConfig.custodyColumns.includes(c.index) && !alreadyPublished.includes(c.index)
    );
    // need to validate both the ones we sample AND ones we will publish
    await validateBlockDataColumnSidecars(slot, blockRoot, blobCount, [...needed, ...needToPublish]);
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

  const peerColumns = new Set(peerMeta.custodyGroups ?? []);
  const requestedColumns = columnMeta.missing.filter((c) => peerColumns.has(c));
  const columnSidecars = await network.sendDataColumnSidecarsByRoot(peerIdStr, [
    {blockRoot, columns: requestedColumns},
  ]);
  for (let i = 0; i < requestedColumns.length; i++) {
    const columnSidecar = columnSidecars[i];
    if (columnSidecar.index !== requestedColumns[i]) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          blockRoot: prettyBytes(blockRoot),
          invalidIndex: columnSidecar.index,
        },
        "Received a columnSidecar that was not requested"
      );
    }
  }
  await validateBlockDataColumnSidecars(slot, blockRoot, blobCount, columnSidecars);

  return columnSidecars;
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

// TODO(fulu) not in use, remove?
export async function fetchColumnsByRoot({
  network,
  peerMeta,
  blockRoot,
  columnMeta,
}: Pick<
  FetchByRootAndValidateColumnsProps,
  "network" | "peerMeta" | "blockRoot" | "columnMeta"
>): Promise<fulu.DataColumnSidecars> {
  return await network.sendDataColumnSidecarsByRoot(peerMeta.peerId, [{blockRoot, columns: columnMeta.missing}]);
}

// TODO(fulu) not in use, remove?
export type ValidateColumnSidecarsProps = Pick<
  FetchByRootAndValidateColumnsProps,
  "config" | "peerMeta" | "blockRoot" | "columnMeta"
> & {
  slot: number;
  blobCount: number;
  needed?: fulu.DataColumnSidecars;
  needToPublish?: fulu.DataColumnSidecars;
};

// TODO(fulu) not in use, remove?
export async function validateColumnSidecars({
  peerMeta,
  slot,
  blockRoot,
  blobCount,
  columnMeta,
  needed = [],
  needToPublish = [],
}: ValidateColumnSidecarsProps): Promise<void> {
  const requestedIndices = columnMeta.missing;
  for (const columnSidecar of needed) {
    if (!requestedIndices.includes(columnSidecar.index)) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerMeta.peerId),
          blockRoot: prettyBytes(blockRoot),
          invalidIndex: columnSidecar.index,
        },
        "Received a columnSidecar that was not requested"
      );
    }
  }
  await validateBlockDataColumnSidecars(slot, blockRoot, blobCount, [...needed, ...needToPublish]);
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
