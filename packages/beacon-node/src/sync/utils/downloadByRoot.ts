import {ChainForkConfig} from "@lodestar/config";
import {ForkPostDeneb, NUMBER_OF_COLUMNS, isForkPostDeneb, isForkPostFulu} from "@lodestar/params";
import {BlobIndex, ColumnIndex, RootHex, SignedBeaconBlock, deneb, fulu, phase0} from "@lodestar/types";
import {LodestarError, fromHex, prettyBytes, toRootHex} from "@lodestar/utils";
import {isBlockInputBlobs, isBlockInputColumns} from "../../chain/blocks/blockInput/blockInput.js";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {validateBlobSidecarInclusionProof, validateBlobsAndBlobProofs} from "../../chain/validation/blobSidecar.js";
import {
  verifyDataColumnSidecarInclusionProof,
  verifyDataColumnSidecarKzgProofs,
} from "../../chain/validation/dataColumnSidecar.js";
import {INetwork} from "../../network/interface.js";
import {prettyPrintPeerIdStr} from "../../network/util.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {PeerIdStr} from "../../util/peerId.js";
import {BlobSidecarsByRootRequest} from "../../util/types.js";
import {BlockInputSyncCacheItem, getBlockInputSyncCacheItemRootHex, isPendingBlockInput} from "../types.js";

export type DownloadByRootCoreProps = {
  config: ChainForkConfig;
  network: INetwork;
  peerIdStr: PeerIdStr;
};
export type DownloadByRootProps = DownloadByRootCoreProps & {
  cacheItem: BlockInputSyncCacheItem;
};
export type DownloadAndValidateBlockProps = DownloadByRootCoreProps & {blockRoot: Uint8Array};
export type DownloadAndValidateBlobsProps = DownloadAndValidateBlockProps & {blobIndices: BlobIndex[]};
export type DownloadAndValidateColumnsProps = DownloadAndValidateBlockProps & {columnIndices: ColumnIndex[]};
export type DownloadByRootResponses = {
  block: SignedBeaconBlock;
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export async function downloadByRoot({
  config,
  network,
  peerIdStr,
  cacheItem,
}: DownloadByRootProps): Promise<DownloadByRootResponses> {
  let block: SignedBeaconBlock;
  let blobSidecars: deneb.BlobSidecars | undefined;
  let columnSidecars: fulu.DataColumnSidecars | undefined;

  const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
  const blockRoot = fromHex(rootHex);

  if (isPendingBlockInput(cacheItem)) {
    if (cacheItem.blockInput.hasBlock()) {
      block = cacheItem.blockInput.getBlock();
    } else {
      block = await downloadAndValidateBlock({
        config,
        network,
        peerIdStr,
        blockRoot,
      });
    }

    if (!cacheItem.blockInput.hasAllData()) {
      if (isBlockInputBlobs(cacheItem.blockInput)) {
        blobSidecars = await downloadAndValidateBlobs({
          config,
          network,
          peerIdStr,
          blockRoot,
          blobIndices: cacheItem.blockInput.getMissingBlobMeta().map((b) => b.index),
        });
      }
      if (isBlockInputColumns(cacheItem.blockInput)) {
        columnSidecars = await downloadAndValidateColumns({
          config,
          network,
          peerIdStr,
          blockRoot,
          columnIndices: cacheItem.blockInput.getMissingSampledColumnMeta().map((c) => c.index),
        });
      }
    }
  } else {
    block = await downloadAndValidateBlock({
      config,
      network,
      peerIdStr,
      blockRoot,
    });
    const forkName = config.getForkName(block.message.slot);
    if (isForkPostFulu(forkName)) {
      columnSidecars = await downloadAndValidateColumns({
        config,
        network,
        peerIdStr,
        blockRoot,
        columnIndices: network.custodyConfig.sampledColumns,
      });
    } else if (isForkPostDeneb(forkName)) {
      const blobCount = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
      blobSidecars = await downloadAndValidateBlobs({
        config,
        network,
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

export async function downloadAndValidateBlock({
  config,
  network,
  peerIdStr,
  blockRoot,
}: DownloadAndValidateBlockProps): Promise<SignedBeaconBlock> {
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

export async function downloadAndValidateBlobs({
  config,
  network,
  peerIdStr,
  blockRoot,
  blobIndices,
}: DownloadAndValidateBlobsProps): Promise<deneb.BlobSidecars> {
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

export async function downloadAndValidateColumns({
  config,
  network,
  peerIdStr,
  blockRoot,
  columnIndices,
}: DownloadAndValidateColumnsProps): Promise<fulu.DataColumnSidecars> {
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

// export function compareIndices(
//   expected: number[],
//   received: number[]
// ): {
//   missingIndices: number;
//   extraIndices: number;
// } {
//   const missingIndices: number[] = [];
//   const extraIndices: number[] = [];

//   for (const index of received) {
//     if (!expected.includes(index)) {
//       extraIndices.push(index);
//     }
//   }
//   for (const index of expected) {
//     if (!received.includes(index)) {
//       missingIndices.push(index);
//     }
//   }

//   return {
//     missingIndices,
//     extraIndices,
//   };
// }

// export async function validateColumnSidecars(
//   config: ChainForkConfig,
//   rootHex: RootHex,
//   requestedIndices: ColumnIndex[],
//   columnSidecars: fulu.DataColumnSidecars
// ): void {
//   for (const columnSidecar of columnSidecars) {
//     if (!requestedIndices.includes(columnSidecar.index)) {
//       throw new DownloadByRootError();
//     }

//     const headerRoot = config
//       .getForkTypes(columnSidecar.signedBlockHeader.message.slot)
//       .BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message);
//     if (rootHex !== toRootHex(headerRoot)) {
//       throw new DownloadByRootError();
//     }

//     if (!verifyDataColumnSidecarInclusionProof(columnSidecar)) {
//       throw new DownloadByRootError();
//     }
//   }

//   try {
//     // TODO(fulu): need to double check that the construction of these arrays is correct
//     await verifyDataColumnSidecarKzgProofs(
//       columnSidecars.flatMap((c) => c.kzgCommitments),
//       columnSidecars.flatMap((c) => Array.from({length: c.column.length}, () => c.index)),
//       columnSidecars.flatMap((c) => c.column),
//       columnSidecars.flatMap((c) => c.kzgProofs)
//     );
//   } catch {
//     throw new DownloadByRootError();
//   }
// }
// export async function validateBlobSidecars(
//   config: ChainForkConfig,
//   rootHex: RootHex,
//   requestedIndices: ColumnIndex[],
//   blobSidecars: fulu.DataColumnSidecars
// ): void {
//   for (const blobSidecar of blobSidecars) {
//     if (!requestedIndices.includes(blobSidecar.index)) {
//       throw new DownloadByRootError();
//     }
//     const headerRoot = config
//       .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
//       .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
//     if (rootHex !== toRootHex(headerRoot)) {
//       throw new DownloadByRootError();
//     }

//     if (!validateBlobSidecarInclusionProof(blobSidecar)) {
//       throw new DownloadByRootError();
//     }
//   }

//   try {
//     await validateBlobsAndBlobProofs(
//       blobSidecars.map((b) => b.kzgCommitment),
//       blobSidecars.map((b) => b.blob),
//       blobSidecars.map((b) => b.kzgProof)
//     );
//   } catch {
//     throw new DownloadByRootError();
//   }
// }

// export async function fetchByRoot({
//   config,
//   peerIdStr,
//   network,
//   blockRoot,
//   block,
//   blobIndices,
//   columnIndices,
// }: FetchByRootProps): DownloadByRootResponses {
//   let blobSidecars: deneb.BlobSidecars | undefined;
//   let columnSidecars: fulu.DataColumnSidecars | undefined;

//   if (!block) {
//     block = await network.sendBeaconBlocksByRoot(peerIdStr, [blockRoot]);
//   }

//   const forkName = config.getForkName(block.message.slot);
//   if (isForkPostFulu(forkName)) {
//     if (!columnIndices) {
//       throw new DownloadByRootError({
//         code: DownloadByRootErrorCode.MISSING_COLUMN_INDICES,
//         blockRoot: prettyBytes(toRootHex(blockRoot)),
//       });
//     }
//     columnSidecars = await network.sendDataColumnSidecarsByRoot(peerIdStr, [{blockRoot, columns: columnIndices}]);
//   } else if (isForkPostDeneb(forkName)) {
//     if (!blobIndices) {
//       const blobCount = (block as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments?.length;
//       blobIndices = Array.from({length: blobCount}, (_, i) => i);
//     }
//     const blobsRequest = blobIndices.map((index) => ({blockRoot, index}));
//     blobSidecars = await network.sendBlobSidecarsByRoot(peerIdStr, blobsRequest);
//   }

//   return {
//     block,
//     blobSidecars,
//     columnSidecars,
//   };
// }

// export type ValidateByRootResponses = DownloadByRootResponses & {cacheItem: BlockInputSyncCacheItem};
// export function validateByRootResponses({
//   cacheItem,
//   block,
//   blobSidecars,
//   columnSidecars,
// }: ValidateByRootResponses): void {
//   const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
//   const blockRootHex = toRootHex(blockRoot);

//   const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
//   if (rootHex !== blockRootHex) {
//   }
// }

// export type ValidateByRootResponses = DownloadByRootRequests & DownloadByRootResponses & {config: ChainForkConfig};
// export function validateByRootResponses({
//   config,
//   blocksRequest: blockRequest,
//   blocks: block,
//   blobsRequest,
//   blobSidecars,
//   columnsRequest,
//   columnSidecars,
// }: ValidateByRootResponses): string {
//   let blockRootHex: string | undefined;
//   if (blockRequest) {
//     if (!block) {
//       throw new DownloadByRootError({
//         code: DownloadByRootErrorCode.MISSING_BLOCK_RESPONSE,
//       });
//     }
//     const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
//     blockRootHex = toRootHex(blockRoot);
//   }
//   if (blobsRequest) {
//     if (!blobSidecars) {
//       throw new DownloadByRootError({
//         code: DownloadByRootErrorCode.MISSING_BLOBS_RESPONSE,
//       });
//     }
//     for (const blobSidecar of blobSidecars) {
//       const blockRoot = config
//         .getForkTypes(blobSidecar.signedBlockHeader.message.slot)
//         .BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
//       const rootHex = toRootHex(blockRoot);
//       if (!blockRootHex) {
//         blockRootHex = rootHex;
//       } else if (blockRootHex !== rootHex) {
//       }
//     }
//     if (blockRootHex) {
//     }
//   }
//   if (columnsRequest) {
//     if (!columnSidecars) {
//       throw new DownloadByRootError({
//         code: DownloadByRootErrorCode.MISSING_BLOBS_RESPONSE,
//       });
//     }

//     const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
//     blockRootHex = toRootHex(blockRoot);
//   }

//   return blockRootHex;
// }

export enum DownloadByRootErrorCode {
  MISMATCH_BLOCK_ROOT = "DOWNLOAD_BY_ROOT_ERROR_MISMATCH_BLOCK_ROOT",
  EXTRA_SIDECAR_RECEIVED = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_SIDECAR_RECEIVED",
  INVALID_INCLUSION_PROOF = "DOWNLOAD_BY_ROOT_ERROR_INVALID_INCLUSION_PROOF",
  INVALID_KZG_PROOF = "DOWNLOAD_BY_ROOT_ERROR_INVALID_KZG_PROOF",
  MISSING_BLOCK_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOCK_RESPONSE",
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
    };

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
