import {ChainForkConfig} from "@lodestar/config";
import {SignedBeaconBlock, SignedBeaconBlockHeader, deneb} from "@lodestar/types";
import {LodestarError, prettyBytes, prettyBytesShort, prettyPrintArray, toHex} from "@lodestar/utils";
import {BlockInput} from "../../chain/blocks/blockInput-mkeil/blockInput.js";
import {BlockInputSource} from "../../chain/blocks/blockInput-mkeil/types.js";
import {SeenBlockInputCache} from "../../chain/seenCache/seenBlockInput.js";
import {INetwork} from "../../network/index.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {PeerIdStr} from "../../util/peerId.js";

export type ByRootRequestBaseProps = {
  cache: SeenBlockInputCache;
  config: ChainForkConfig;
  network: INetwork;
  peerIdStr: PeerIdStr;
};

export type ByRootRequests = {
  blocksRequest?: Uint8Array[];
  blobRequest?: {blockRoot: Uint8Array; index: number}[];
  // columnRequest?: {blockRoot: Uint8Array; index: number}[];
};

export type ByRootResponses = {
  blocks?: SignedBeaconBlock[];
  blobSidecars?: deneb.BlobSidecars;
  // columnSidecars: fulu.DataColumnSidecar;
};

export type CacheByRootProps = {
  blockResponse?: ReceivedBlock[];
  blobResponse?: ReceivedSidecar<deneb.BlobSidecar>[];
  // columnResponse?: ReceivedSidecar<fulu.DataColumnSidecar>[];
};

export type ReceivedBlock = {
  block: SignedBeaconBlock;
  blockRoot: Uint8Array;
};

export async function downloadByRoot({
  cache,
  config,
  network,
  peerIdStr,
  blocksRequest,
  blobRequest,
  // columnRequest,
}: ByRootRequestBaseProps & ByRootRequests): Promise<Map<string, BlockInput>> {
  const {
    blocks,
    blobSidecars,
    // columnSidecars
  } = await requestByRoot({
    config,
    network,
    peerIdStr,
    blocksRequest,
    blobRequest,
    // columnRequest,
  });

  const {
    blockResponse,
    blobResponse,
    // columnResponse
  } = compareByRootRequestsToResponses({
    config,
    peerIdStr,
    blocksRequest,
    blobRequest,
    // columnRequest,
    blocks,
    blobSidecars,
    // columnSidecars,
  });

  const cached = cacheByRootResponses({
    cache,
    peerIdStr,
    blockResponse,
    blobResponse,
    // columnResponse,
  });

  return cached;
}

export async function requestByRoot({
  network,
  peerIdStr,
  blocksRequest,
  blobRequest,
  //  columnRequest,
}: Omit<ByRootRequestBaseProps, "cache"> & ByRootRequests): Promise<ByRootResponses> {
  const requests: Promise<unknown>[] = [];

  let blocks: undefined | SignedBeaconBlock[];
  if (blocksRequest) {
    requests.push(
      network.sendBeaconBlocksByRoot(peerIdStr, blocksRequest).then((response) => {
        blocks = response.map(({data}) => data);
      })
    );
  }

  let blobs: undefined | deneb.BlobSidecars;
  if (blobRequest) {
    requests.push(
      network.sendBlobSidecarsByRoot(peerIdStr, blobRequest).then((response) => {
        blobs = response;
      })
    );
  }

  // let columns: undefined | fulu.ColumnSidecars;
  // if (columnRequest) {
  //   requests.push(
  //     network.sendBlobSidecarsByRoot(peerIdStr, columnRequest).then((response) => {
  //       columns = response;
  //     })
  //   );
  // }

  await Promise.all(requests);

  return {
    blocks,
    blobSidecars: blobs,
    // columns,
  };
}

export function compareByRootRequestsToResponses({
  config,
  peerIdStr,
  blocksRequest,
  blobRequest,
  // columnRequest,
  blocks,
  blobSidecars,
  // columnSidecars,
}: Omit<ByRootRequestBaseProps, "network" | "cache"> & ByRootRequests & ByRootResponses): CacheByRootProps {
  let blockResponse: undefined | ReceivedBlock[];
  if (blocksRequest) {
    if (!blocks) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISSING_BLOCKS_RESPONSE,
        },
        "No blocks to check against blocksResponse"
      );
    }

    const {receivedBlocks, extraBlocks, missingBlocks} = compareBlocksByRootRequestToResponse(
      config,
      blocksRequest,
      blocks
    );
    blockResponse = receivedBlocks;

    if (missingBlocks.length) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISSING_BLOCKS,
          peerId: peerIdStr,
          missing: prettyPrintArray(missingBlocks.map(prettyBytes)),
        },
        "BlocksByRoot did not return all the requested blocks"
      );
    }

    if (extraBlocks.length) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_BLOCKS,
          peerId: peerIdStr,
          extra: prettyPrintArray(extraBlocks.map(prettyBytes)),
        },
        "BlocksByRoot returned extra blocks that were not requested"
      );
    }
  }

  let blobResponse: undefined | ReceivedSidecar<deneb.BlobSidecar>[];
  if (blobRequest) {
    if (!blobSidecars) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISSING_BLOBS_RESPONSE,
        },
        "No blobSidecars to check against blobRequest"
      );
    }

    const {receivedSidecars, extraSidecars, missingSidecars} = compareSidecarByRootRequestToResponse<deneb.BlobSidecar>(
      config,
      blobRequest,
      blobSidecars
    );
    blobResponse = receivedSidecars;

    if (missingSidecars.length) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.MISSING_BLOBS,
          peerId: peerIdStr,
          missing: prettyPrintArray(
            missingSidecars.map(({blockRoot, index}) => `${prettyBytesShort(blockRoot)}:${index}`)
          ),
        },
        "BlobsByRoot did not return all the requested blobSidecars"
      );
    }

    if (extraSidecars.length) {
      throw new DownloadByRootError(
        {
          code: DownloadByRootErrorCode.EXTRA_BLOBS,
          peerId: peerIdStr,
          extra: prettyPrintArray(extraSidecars.map(({blockRoot, index}) => `${prettyBytesShort(blockRoot)}:${index}`)),
        },
        "BlobsByRoot returned extra blobSidecars that were not requested"
      );
    }
  }

  // let columnsResponse: undefined | ReceivedSidecar<fulu.DataColumnSidecar>[];
  // if (columnRequest) {
  //   if (!columnSidecars) {
  //     throw new DownloadByRootError(
  //       {
  //         code: DownloadByRootErrorCode.MISSING_COLUMNS_RESPONSE,
  //       },
  //       "No columnSidecars to check against columnRequest"
  //     );
  //   }

  //   const {receivedSidecars, extraSidecars, missingSidecars} =
  //     compareSidecarByRootRequestToResponse<fulu.DataColumnSidecar>(config, columnRequest, columnSidecars);
  //   columnsResponse = receivedSidecars;

  //   if (missingSidecars.length) {
  //     throw new DownloadByRootError(
  //       {
  //         code: DownloadByRootErrorCode.MISSING_COLUMNS,
  //         peerId: peerIdStr,
  //         missing: prettyPrintArray(missingSidecars.map(prettyBytes)),
  //       },
  //       "ColumnsByRoot did not return all the requested columnSidecars"
  //     );
  //   }

  //   if (extraSidecars.length) {
  //     throw new DownloadByRootError(
  //       {
  //         code: DownloadByRootErrorCode.EXTRA_COLUMNS,
  //         peerId: peerIdStr,
  //         missing: prettyPrintArray(extraSidecars.map(prettyBytes)),
  //       },
  //       "ColumnsByRoot returned extra columnSidecars that were not requested"
  //     );
  //   }
  // }

  return {
    blockResponse,
    blobResponse,
    // columnsResponse,
  };
}

export function cacheByRootResponses({
  cache,
  peerIdStr,
  blockResponse,
  blobResponse,
  // columnResponse,
}: {cache: SeenBlockInputCache; peerIdStr: PeerIdStr} & CacheByRootProps): Map<string, BlockInput> {
  const updated = new Map<string, BlockInput>();
  if (blockResponse) {
    for (const {block, blockRoot} of blockResponse) {
      const blockInput = cache.getBlockInputByBlock({
        block,
        blockRoot,
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now(),
        peerIdStr,
      });
      updated.set(blockInput.rootHex, blockInput);
    }
  }

  if (blobResponse) {
    for (const {blockRoot, sidecar} of blobResponse) {
      const blockInput = cache.getBlockInputByBlob({
        blockRoot,
        peerIdStr,
        blobSidecar: sidecar,
        seenTimestampSec: Date.now(),
        source: BlockInputSource.byRoot,
      });
      updated.set(blockInput.rootHex, blockInput);
    }
  }

  // if (columnResponse) {
  //   for (const {blockRoot, sidecar} of columnResponse) {
  //     const blockInput = cache.getBlockInputByColumn({
  //       blockRoot,
  //       peerIdStr,
  //       columnSidecar: sidecar,
  //       seenTimestampSec: Date.now(),
  //       source: BlockInputSource.byRoot,
  //     });
  //     updated.set(blockInput.rootHex, blockInput);
  //   }
  // }

  return updated;
}

export function compareBlocksByRootRequestToResponse(
  config: ChainForkConfig,
  blocksRequest: Uint8Array[],
  blocks: SignedBeaconBlock[]
) {
  const extraBlocks: Uint8Array[] = [];
  const receivedBlocks: ReceivedBlock[] = [];
  for (const block of blocks) {
    const blockRoot = config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
    if (blocksRequest.findIndex((request) => byteArrayEquals(request, blockRoot)) === -1) {
      extraBlocks.push(blockRoot);
    } else {
      receivedBlocks.push({block, blockRoot});
    }
  }

  const missingBlocks: Uint8Array[] = [];
  if (receivedBlocks.length < blocksRequest.length) {
    for (const request of blocksRequest) {
      if (receivedBlocks.findIndex(({blockRoot}) => byteArrayEquals(request, blockRoot)) === -1) {
        missingBlocks.push(request);
      }
    }
  }

  return {
    receivedBlocks,
    missingBlocks,
    extraBlocks,
  };
}

export type ReceivedSidecar<Sidecar extends {index: number; signedBlockHeader: SignedBeaconBlockHeader}> = {
  sidecar: Sidecar;
  blockRoot: Uint8Array;
};

export function compareSidecarByRootRequestToResponse<
  Sidecar extends {index: number; signedBlockHeader: SignedBeaconBlockHeader},
>(config: ChainForkConfig, request: {blockRoot: Uint8Array; index: number}[], sidecars: Sidecar[]) {
  const extraSidecars: {blockRoot: Uint8Array; index: number}[] = [];
  const receivedSidecars: ReceivedSidecar<Sidecar>[] = [];
  for (const sidecar of sidecars) {
    const {index} = sidecar;
    const blockRoot = config
      .getForkTypes(sidecar.signedBlockHeader.message.slot)
      .BeaconBlockHeader.hashTreeRoot(sidecar.signedBlockHeader.message);
    const requestIndex = request.findIndex((request) => {
      return byteArrayEquals(request.blockRoot, blockRoot) && request.index === index;
    });
    if (requestIndex === -1) {
      extraSidecars.push({blockRoot, index});
    } else {
      receivedSidecars.push({sidecar, blockRoot});
    }
  }

  const missingSidecars: {blockRoot: Uint8Array; index: number}[] = [];
  if (receivedSidecars.length < request.length) {
    for (const {blockRoot, index} of request) {
      const receivedIndex = receivedSidecars.findIndex(
        (received) => received.blockRoot === blockRoot && received.sidecar.index === index
      );
      if (receivedIndex === -1) {
        missingSidecars.push({blockRoot, index});
      }
    }
  }

  return {
    receivedSidecars,
    missingSidecars,
    extraSidecars,
  };
}

export enum DownloadByRootErrorCode {
  MISSING_BLOCKS_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOCKS_RESPONSE",
  MISSING_BLOBS_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOBS_RESPONSE",
  //   MISSING_COLUMNS_RESPONSE = "DOWNLOAD_BY_ROOT_ERROR_MISSING_COLUMNS_RESPONSE",

  MISSING_BLOCKS = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOCKS",
  MISSING_BLOBS = "DOWNLOAD_BY_ROOT_ERROR_MISSING_BLOBS",
  //   MISSING_COLUMNS = "DOWNLOAD_BY_ROOT_ERROR_MISSING_COLUMNS",

  EXTRA_BLOCKS = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_BLOCKS",
  EXTRA_BLOBS = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_BLOBS",
  //   EXTRA_COLUMNS = "DOWNLOAD_BY_ROOT_ERROR_EXTRA_COLUMNS",
}

export type DownloadByRootErrorType =
  | {
      code:
        | DownloadByRootErrorCode.MISSING_BLOCKS_RESPONSE
        // | DownloadByRootErrorCode.MISSING_COLUMNS_RESPONSE
        | DownloadByRootErrorCode.MISSING_BLOBS_RESPONSE;
    }
  | {
      code:
        | DownloadByRootErrorCode.MISSING_BLOCKS
        // | DownloadByRootErrorCode.MISSING_COLUMNS
        | DownloadByRootErrorCode.MISSING_BLOBS;
      peerId: PeerIdStr;
      missing: string;
    }
  | {
      code:
        | DownloadByRootErrorCode.EXTRA_BLOCKS
        // | DownloadByRootErrorCode.EXTRA_COLUMNS;
        | DownloadByRootErrorCode.EXTRA_BLOBS;
      peerId: PeerIdStr;
      extra: string;
    };

export class DownloadByRootError extends LodestarError<DownloadByRootErrorType> {}
