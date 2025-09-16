import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, ForkPostFulu, ForkPreFulu, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {SignedBeaconBlock, Slot, deneb, fulu} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {BlobMeta, BlockInputSource, IBlockInput, MissingColumnMeta} from "../../chain/blocks/blockInput/types.js";
import {SeenBlockInput} from "../../chain/seenCache/seenGossipBlockInput.js";
import {validateBlockBlobSidecars} from "../../chain/validation/blobSidecar.js";
import {validateBlockDataColumnSidecars} from "../../chain/validation/dataColumnSidecar.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";
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
  blobMeta: BlobMeta[];
};
export type FetchByRootAndValidateColumnsProps = FetchByRootCoreProps & {
  blockRoot: Uint8Array;
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

export async function fetchByRoot(
  opts: FetchByRootProps
): Promise<WarnResult<FetchByRootResponses, DownloadByRootError>> {
  const {config, network, peerMeta, blockRoot, cacheItem} = opts;
  let blobSidecars: undefined | deneb.BlobSidecars;
  let columnSidecars: undefined | fulu.DataColumnSidecars;
  const allWarnings: DownloadByRootError[] = [];

  const hasBlock = isPendingBlockInput(cacheItem) && cacheItem.blockInput.hasBlock();
  const hasAllData = isPendingBlockInput(cacheItem) && cacheItem.blockInput.hasAllData();

  const requests: Promise<unknown>[] = [];

  // TODO: Make the block request in parallel to blob/column requests
  // Once we have the way to know the fork and and blob count before requesting the block
  // We can then add this request to array of requests and make all requests in parallel
  const block = hasBlock
    ? cacheItem.blockInput.getBlock()
    : await fetchBeaconBlockByRoot({network, config, peerMeta, blockRoot});

  const forkName = config.getForkName(block.message.slot);
  const isPostFulu = isForkPostFulu(forkName);
  const isPostDeneb = isForkPostDeneb(forkName);

  const queueBlobRequest = (blobMeta: BlobMeta[]): void => {
    requests.push(
      fetchAndValidateBlobs({
        ...opts,
        forkName: forkName as ForkPreFulu,
        block: block as SignedBeaconBlock<ForkPostDeneb>,
        peerIdStr: peerMeta.peerId,
        blobMeta,
      }).then(async (response) => {
        blobSidecars = response;
      })
    );
  };

  const queueDataColumnRequest = (columnMeta: MissingColumnMeta): void => {
    requests.push(
      fetchAndValidateColumns({
        ...opts,
        forkName: forkName as ForkPostFulu,
        block: block as SignedBeaconBlock<ForkPostFulu>,
        columnMeta,
      }).then(({result, warnings}) => {
        columnSidecars = result;
        allWarnings.push(...(warnings ?? []));
      })
    );
  };

  if (hasBlock && !hasAllData) {
    if (isBlockInputBlobs(cacheItem.blockInput)) {
      const blobsMeta = cacheItem.blockInput.getMissingBlobMeta();
      queueBlobRequest(blobsMeta);
    } else if (isBlockInputColumns(cacheItem.blockInput)) {
      const columnsMeta = {
        missing: network.custodyConfig.sampledColumns,
        versionedHashes: (block as SignedBeaconBlock<ForkPostFulu>).message.body.blobKzgCommitments.map((c) =>
          kzgCommitmentToVersionedHash(c)
        ),
      };
      queueDataColumnRequest(columnsMeta);
    }
  } else if (!hasBlock) {
    if (isPostFulu) {
      const blobsMeta = {
        missing: network.custodyConfig.sampledColumns,
        versionedHashes: (block as SignedBeaconBlock<ForkPostFulu>).message.body.blobKzgCommitments.map((c) =>
          kzgCommitmentToVersionedHash(c)
        ),
      };
      queueDataColumnRequest(blobsMeta);
    } else if (isPostDeneb) {
      const commitments = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments;
      const blobCount = commitments.length;
      const blobMeta = Array.from({length: blobCount}, (_, i) => ({
        index: i,
        blockRoot,
        versionedHash: kzgCommitmentToVersionedHash(commitments[i]),
      }));
      queueBlobRequest(blobMeta);
    }
  }

  await Promise.all(requests);

  return {
    result: {block, blobSidecars, columnSidecars},
    warnings: allWarnings,
  };
}

export async function fetchBeaconBlockByRoot({
  network,
  config,
  peerMeta,
  blockRoot,
}: Pick<
  FetchByRootAndValidateColumnsProps,
  "network" | "config" | "peerMeta" | "blockRoot"
>): Promise<SignedBeaconBlock> {
  const response = await network.sendBeaconBlocksByRoot(peerMeta.peerId, [blockRoot]);
  const block = response.at(0)?.data;
  const peerIdStr = peerMeta.peerId;
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
  block,
  network,
  peerIdStr,
  blobMeta,
  blockRoot,
}: FetchByRootAndValidateBlobsProps): Promise<deneb.BlobSidecars> {
  if (!blobMeta.length) return [];

  const blobs = await network.sendBlobSidecarsByRoot(
    peerIdStr,
    blobMeta.map(({blockRoot, index}) => ({blockRoot, index}))
  );

  await validateBlockBlobSidecars(
    block.message.slot,
    blockRoot,
    // Earlier `blobMeta.length` was used. Which feels incorrect as we should validate
    // against the  `blockBlobCount`
    (block as deneb.SignedBeaconBlock).message.body.blobKzgCommitments.length,
    blobs
  );

  return blobs;
}

export async function fetchAndValidateColumns({
  network,
  peerMeta,
  block,
  blockRoot,
  columnMeta,
}: FetchByRootAndValidateColumnsProps): Promise<WarnResult<fulu.DataColumnSidecars, DownloadByRootError>> {
  const {peerId: peerIdStr} = peerMeta;
  const slot = block.message.slot;
  const blobCount = block.message.body.blobKzgCommitments.length;
  if (blobCount === 0) {
    return {result: [], warnings: null};
  }

  const blockRootHex = toRootHex(blockRoot);
  const peerColumns = new Set(peerMeta.custodyGroups ?? []);
  const requestedColumns = columnMeta.missing.filter((c) => peerColumns.has(c));
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
