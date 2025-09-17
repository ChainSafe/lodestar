import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, ForkPostFulu, ForkPreFulu, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {BlobIndex, ColumnIndex, SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlockInputSource, IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlockBlobSidecars} from "../../chain/validation/blobSidecar.js";
import {validateBlockDataColumnSidecars} from "../../chain/validation/dataColumnSidecar.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {
  BlockInputSyncCacheItem,
  PendingBlockInput,
  PendingBlockInputStatus,
  getBlockInputSyncCacheItemRootHex,
  isPendingBlockInput,
} from "../types.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {PeerIdStr} from "../../util/peerId.js";
import {WarnResult} from "../../util/wrapError.js";

export type FetchByRootCoreProps = {
  config: ChainForkConfig;
  network: INetwork;
  peerMeta: PeerSyncMeta;
};
export type FetchByRootProps = FetchByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
  blockRoot: Uint8Array;
};
export type FetchByRootAndValidateBlockProps = Omit<FetchByRootCoreProps, "peerMeta"> & {
  peerIdStr: PeerIdStr;
  blockRoot: Uint8Array;
};
export type FetchByRootAndValidateBlobsProps = FetchByRootAndValidateBlockProps & {
  forkName: ForkPreFulu;
  block: SignedBeaconBlock<ForkPostDeneb>;
  blockRoot: Uint8Array;
  missing: BlobIndex[];
};
export type FetchByRootAndValidateColumnsProps = FetchByRootCoreProps & {
  blockRoot: Uint8Array;
  forkName: ForkPostFulu;
  block: SignedBeaconBlock<ForkPostFulu>;
  missing: ColumnIndex[];
};
export type FetchByRootResponses = {
  block: SignedBeaconBlock;
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export type DownloadByRootProps = FetchByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
  seenCache: SeenBlockInput;
};
export async function downloadByRoot({
  config,
  seenCache,
  network,
  peerMeta,
  cacheItem,
}: DownloadByRootProps): Promise<WarnResult<PendingBlockInput, DownloadByRootError>> {
  const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
  const blockRoot = fromHex(rootHex);
  const {peerId: peerIdStr} = peerMeta;

  const {
    result: {block, blobSidecars, columnSidecars},
    warnings,
  } = await fetchByRoot({
    config,
    network,
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

  const hasAllDataPreDownload = blockInput.hasBlockAndAllData();

  if (isBlockInputBlobs(blockInput) && !hasAllDataPreDownload) {
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

  if (isBlockInputColumns(blockInput) && !hasAllDataPreDownload) {
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
  if (blockInput.hasBlockAndAllData()) {
    status = PendingBlockInputStatus.downloaded;
    timeSyncedSec = Date.now() / 1000;
  } else {
    status = PendingBlockInputStatus.pending;
  }

  return {
    result: {
      status,
      blockInput,
      timeSyncedSec,
      timeAddedSec: cacheItem.timeAddedSec,
      peerIdStrings: cacheItem.peerIdStrings,
    },
    warnings,
  };
}

export async function fetchByRoot({
  config,
  network,
  peerMeta,
  blockRoot,
  cacheItem,
}: FetchByRootProps): Promise<WarnResult<FetchByRootResponses, DownloadByRootError>> {
  let block: SignedBeaconBlock;
  let blobSidecars: deneb.BlobSidecars | undefined;
  let columnSidecarResult: WarnResult<fulu.DataColumnSidecars, DownloadByRootError> | undefined;
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
          peerIdStr,
          forkName: forkName as ForkPreFulu,
          block: block as SignedBeaconBlock<ForkPostDeneb>,
          blockRoot,
          missing: cacheItem.blockInput.getMissingBlobMeta().map(({index}) => index),
        });
      }
      if (isBlockInputColumns(cacheItem.blockInput)) {
        columnSidecarResult = await fetchAndValidateColumns({
          config,
          network,
          peerMeta,
          forkName: forkName as ForkPostFulu,
          block: block as SignedBeaconBlock<ForkPostFulu>,
          blockRoot,
          missing: cacheItem.blockInput.getMissingSampledColumnMeta().missing,
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
      columnSidecarResult = await fetchAndValidateColumns({
        config,
        network,
        peerMeta,
        forkName,
        blockRoot,
        block: block as SignedBeaconBlock<ForkPostFulu>,
        missing: network.custodyConfig.sampledColumns,
      });
    } else if (isForkPostDeneb(forkName)) {
      const commitments = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments;
      const blobCount = commitments.length;
      blobSidecars = await fetchAndValidateBlobs({
        config,
        network,
        peerIdStr,
        forkName: forkName as ForkPreFulu,
        blockRoot,
        block: block as SignedBeaconBlock<ForkPostDeneb>,
        missing: Array.from({length: blobCount}, (_, i) => i),
      });
    }
  }

  return {
    result: {
      block,
      blobSidecars,
      columnSidecars: columnSidecarResult?.result,
    },
    warnings: columnSidecarResult?.warnings ?? null,
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
  network,
  peerIdStr,
  blockRoot,
  block,
  missing,
}: FetchByRootAndValidateBlobsProps): Promise<deneb.BlobSidecars> {
  const blobSidecars: deneb.BlobSidecars = await fetchBlobsByRoot({
    network,
    peerIdStr,
    blockRoot,
    missing,
  });

  await validateBlockBlobSidecars(block.message.slot, blockRoot, missing.length, blobSidecars);

  return blobSidecars;
}

export async function fetchBlobsByRoot({
  network,
  peerIdStr,
  blockRoot,
  missing,
  indicesInPossession = [],
}: Pick<FetchByRootAndValidateBlobsProps, "network" | "peerIdStr" | "blockRoot" | "missing"> & {
  indicesInPossession?: number[];
}): Promise<deneb.BlobSidecars> {
  const blobsRequest = missing
    .filter((index) => !indicesInPossession.includes(index))
    .map((index) => ({blockRoot, index}));
  if (!blobsRequest.length) {
    return [];
  }
  return await network.sendBlobSidecarsByRoot(peerIdStr, blobsRequest);
}

export async function fetchAndValidateColumns({
  network,
  peerMeta,
  block,
  blockRoot,
  missing,
}: FetchByRootAndValidateColumnsProps): Promise<WarnResult<fulu.DataColumnSidecars, DownloadByRootError>> {
  const {peerId: peerIdStr} = peerMeta;
  const slot = block.message.slot;
  const blobCount = block.message.body.blobKzgCommitments.length;
  if (blobCount === 0) {
    return {result: [], warnings: null};
  }

  const blockRootHex = toRootHex(blockRoot);
  const peerColumns = new Set(peerMeta.custodyColumns ?? []);
  const requestedColumns = missing.filter((c) => peerColumns.has(c));
  const columnSidecars = await network.sendDataColumnSidecarsByRoot(peerIdStr, [
    {blockRoot, columns: requestedColumns},
  ]);

  const warnings: DownloadByRootError[] = [];

  // it's not acceptable if no sidecar is returned with >0 blobCount
  if (columnSidecars.length === 0) {
    throw new DownloadByRootError({
      code: DownloadByRootErrorCode.NO_SIDECAR_RECEIVED,
      peer: prettyPrintPeerIdStr(peerIdStr),
      slot,
      blockRoot: blockRootHex,
    });
  }

  // it's ok if only some sidecars are returned, we will try to get the rest from other peers
  const requestedColumnsSet = new Set(requestedColumns);
  const returnedColumns = columnSidecars.map((c) => c.index);
  const returnedColumnsSet = new Set(returnedColumns);
  const missingIndices = requestedColumns.filter((c) => !returnedColumnsSet.has(c));
  if (missingIndices.length > 0) {
    warnings.push(
      new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.NOT_ENOUGH_SIDECARS_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          slot,
          blockRoot: blockRootHex,
          missingIndices: prettyPrintIndices(missingIndices),
        },
        "Did not receive all of the requested columnSidecars"
      )
    );
  }

  // check extra returned columnSidecar
  const extraIndices = returnedColumns.filter((c) => !requestedColumnsSet.has(c));
  if (extraIndices.length > 0) {
    warnings.push(
      new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
          peer: prettyPrintPeerIdStr(peerIdStr),
          slot,
          blockRoot: blockRootHex,
          invalidIndices: prettyPrintIndices(extraIndices),
        },
        "Received columnSidecars that were not requested"
      )
    );
  }

  await validateBlockDataColumnSidecars(slot, blockRoot, blobCount, columnSidecars);

  return {result: columnSidecars, warnings: warnings.length > 0 ? warnings : null};
}

// TODO(fulu) not in use, remove?
export async function fetchColumnsByRoot({
  network,
  peerMeta,
  blockRoot,
  missing,
}: Pick<
  FetchByRootAndValidateColumnsProps,
  "network" | "peerMeta" | "blockRoot" | "missing"
>): Promise<fulu.DataColumnSidecars> {
  return await network.sendDataColumnSidecarsByRoot(peerMeta.peerId, [{blockRoot, columns: missing}]);
}

// TODO(fulu) not in use, remove?
export type ValidateColumnSidecarsProps = Pick<
  FetchByRootAndValidateColumnsProps,
  "config" | "peerMeta" | "blockRoot" | "missing"
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
  missing,
  needed = [],
  needToPublish = [],
}: ValidateColumnSidecarsProps): Promise<void> {
  const requestedIndices = missing;
  const extraIndices: number[] = [];
  for (const columnSidecar of needed) {
    if (!requestedIndices.includes(columnSidecar.index)) {
      extraIndices.push(columnSidecar.index);
    }
  }
  if (extraIndices.length > 0) {
    throw new DownloadByRootError(
      {
        code: DownloadByRootErrorCode.EXTRA_SIDECAR_RECEIVED,
        peer: prettyPrintPeerIdStr(peerMeta.peerId),
        slot,
        blockRoot: prettyBytes(blockRoot),
        invalidIndices: prettyPrintIndices(extraIndices),
      },
      "Received a columnSidecar that was not requested"
    );
  }
  await validateBlockDataColumnSidecars(slot, blockRoot, blobCount, [...needed, ...needToPublish]);
}

export enum DownloadByRootErrorCode {
  MISMATCH_BLOCK_ROOT = "DOWNLOAD_BY_ROOT_ERROR_MISMATCH_BLOCK_ROOT",
  EXTRA_SIDECAR_RECEIVED = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_SIDECAR_RECEIVED",
  NO_SIDECAR_RECEIVED = "DOWNLOAD_BY_ROOT_ERROR_NO_SIDECAR_RECEIVED",
  NOT_ENOUGH_SIDECARS_RECEIVED = "DOWNLOAD_BY_ROOT_ERROR_NOT_ENOUGH_SIDECARS_RECEIVED",
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
      slot: Slot;
      blockRoot: string;
      invalidIndices: string;
    }
  | {
      code: DownloadByRootErrorCode.NO_SIDECAR_RECEIVED;
      peer: string;
      slot: Slot;
      blockRoot: string;
    }
  | {
      code: DownloadByRootErrorCode.NOT_ENOUGH_SIDECARS_RECEIVED;
      peer: string;
      slot: Slot;
      blockRoot: string;
      missingIndices: string;
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
