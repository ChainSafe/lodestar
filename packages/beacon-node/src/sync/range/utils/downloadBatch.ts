import assert from "node:assert";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {
  BlockInput,
  BlockInputBlobs,
  BlockInputByRootRequests,
  BlockInputSourceType,
  BlockInputType,
  MissingBlob,
  MissingData,
} from "../../../chain/blocks/utils/blockInput.js";
import {BlockInputCache} from "../../../chain/blocks/utils/blockInputCache.js";
import {IBeaconChain} from "../../../chain/interface.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {Batch} from "../batch.js";
import {
  ForkName,
  ForkPostDeneb,
  isForkBlobs,
  isForkPostDeneb,
  isForkPostFulu,
  MAX_REQUEST_BLOCKS,
  MAX_REQUEST_DATA_COLUMN_SIDECARS,
} from "@lodestar/params";
import {INetwork} from "../../../network/index.js";
import {linspace} from "../../../util/numpy.js";
import {ColumnIndex, deneb, fulu, phase0, RootHex, SignedBeaconBlock, Slot, WithBytes} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {LodestarError} from "@lodestar/utils";

export enum DownloadByRangeErrorCode {
  MISSING_BLOBS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_REQUEST",
  MISSING_COLUMNS_REQUEST = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_REQUEST",
  START_SLOT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_START_SLOT_MISMATCH",
  COUNT_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_COUNT_MISMATCH",
  REQ_RESP_ERROR = "DOWNLOAD_BY_RANGE_ERROR_REQ_RESP_ERROR",
  MISSING_BLOCKS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOCKS",
  MISSING_BLOBS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS_RESPONSE",
  MISSING_BLOBS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_BLOBS",
  MISSING_COLUMNS_RESPONSE = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS_RESPONSE",
  MISSING_COLUMNS = "DOWNLOAD_BY_RANGE_ERROR_MISSING_COLUMNS",

  /**
   *
   *
   *
   */
  //   INVALID_EXPECTED_BLOBS_COUNT = "DOWNLOAD_BY_RANGE_ERROR_INVALID_EXPECTED_BLOBS_COUNT",
  RANGE_MISMATCH = "DOWNLOAD_BY_RANGE_ERROR_RANGE_MISMATCH",
  Z = "DOWNLOAD_BY_RANGE_ERROR_Z",
}

export type DownloadByRangeErrorType =
  | {
      code:
        | DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST
        | DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE
        | DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST
        | DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE;
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
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR;
      name: string;
      message: string;
      stack: string | undefined;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_BLOCKS;
      missingSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_BLOBS;
      expectedBlobCount: number;
      missingBlobCount: number;
      slotsWithIndices: string;
    }
  | {
      code: DownloadByRangeErrorCode.MISSING_COLUMNS;
      missingColumnCount: number;
      indicesWithSlots: string;
    }
  | {
      code: DownloadByRangeErrorCode.INADEQUATE_COLUMN_CUSTODY;
    };
//   | {
//       code: DownloadByRangeErrorCode.INVALID_EXPECTED_BLOBS_COUNT;
//       slot: number;
//     }
//   | {
//       code: DownloadByRangeErrorCode.RANGE_MISMATCH;
//       blockRange: string;
//       dataRange: string;
//     }

export class DownloadByRangeError extends LodestarError<DownloadByRangeErrorType> {}

type DownloadByRangeRequests = {
  blocksRequest: phase0.BeaconBlocksByRangeRequest;
  blobRequest?: deneb.BlobSidecarsByRangeRequest;
  columnRequest?: fulu.DataColumnSidecarsByRangeRequest;
};

type DownloadByRangeResponses = {
  blocks: WithBytes<SignedBeaconBlock>[];
  blobSidecars?: deneb.BlobSidecars;
  columnSidecars?: fulu.DataColumnSidecars;
};

export async function downloadByRange({
  config,
  dataAvailabilityStatus,
  blocksRequest,
  blobRequest,
  columnRequest,
}: DownloadByRangeRequests & {config: ChainForkConfig; dataAvailabilityStatus: DataAvailabilityStatus}) {
  const slotRange = `[ ${blocksRequest.startSlot} - ${blocksRequest.startSlot + blocksRequest.count}`;

  // TODO: should we check for requests across a fork boundary?

  if (dataAvailabilityStatus === DataAvailabilityStatus.Available) {
    const forkName = config.getForkName(blocksRequest.startSlot);
    if (isForkBlobs(forkName) && !blobRequest) {
      throw new DownloadByRangeError({code: DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST, slotRange});
    }
    if (isForkPostFulu(forkName) && !columnRequest) {
      throw new DownloadByRangeError({code: DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST, slotRange});
    }
  }

  const dataRequest = blobRequest ?? columnRequest;
  if (dataRequest) {
    if (blocksRequest.startSlot !== dataRequest.startSlot) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.START_SLOT_MISMATCH,
        blockStartSlot: blocksRequest.startSlot,
        dataStartSlot: dataRequest.startSlot,
      });
    }
    if (blocksRequest.count !== dataRequest.count) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.COUNT_MISMATCH,
        blockStart: blocksRequest.count,
        dataStart: dataRequest.count,
      });
    }
  }

  let response: DownloadByRangeResponses;
  try {
    response = requestByRange();
  } catch (err) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.REQ_RESP_ERROR,
      name: (err as Error).name,
      message: (err as Error).message,
      stack: (err as Error).stack,
    });
  }

  compareByRangeRequestsToResponse({config, slotRange, blocksRequest, blobRequest, columnRequest, ...response});

  return response;
}

// Should not be called directly. Only exported for unit testing purposes
export async function requestByRange({
  network,
  peerIdStr,
  blocksRequest,
  blobRequest,
  columnRequest,
}: DownloadByRangeRequests & {
  network: INetwork;
  peerIdStr: PeerIdStr;
}): // {errors: Error[]} &
DownloadByRangeResponses {
  // const errors: Error[] = [];
  const blocks: WithBytes<SignedBeaconBlock>[] = [];
  const blobSidecars: deneb.BlobSidecars = [];
  const columnSidecars: fulu.DataColumnSidecars = [];

  const requests: Promise[] = [
    network
      .sendBeaconBlocksByRange(peerIdStr, blocksRequest)
      .then((blockResponse) => {
        blocks.push(...blockResponse);
      }),
    // .catch(errors.push),
  ];

  if (blobRequest) {
    requests.push(
      network
        .sendBlobSidecarsByRange(peerIdStr, blobRequest)
        .then((blobResponse) => {
          blobSidecars.push(...blobResponse);
        })
      // .catch(errors.push)
    );
  }

  if (columnRequest) {
    requests.push(
      network
        .sendDataColumnSidecarsByRange(peerIdStr, columnRequest)
        .then((columnResponse) => {
          columnSidecars.push(...columnResponse);
        })
      // .catch(errors.push)
    );
  }

  await Promise.all(requests);

  return {
    // errors,
    blocks,
    blobSidecars: blobRequest ? blobSidecars : undefined,
    columnSidecars: columnRequest ? columnSidecars : undefined,
  };
}

// Should not be called directly. Only exported for unit testing purposes
export function compareBlockByRangeRequestAndResponse(
  blocksRequest: phase0.BeaconBlocksByRangeRequest,
  blocks: WithBytes<SignedBeaconBlock>[]
): {missingSlots: number[]} {
  const {startSlot, count} = blocksRequest;
  const slotsReceived = blocks.map((block) => block.data.message.slot);

  const missingSlots: number[] = [];
  for (let slot = startSlot; slot < startSlot + count; slot++) {
    if (!slotsReceived.includes(slot)) {
      missingSlots.push(slot);
    }
  }

  return {
    missingSlots,
  };
}

type BlobComparisonResponse = {
  expectedBlobCount: number;
  missingBlobCount: number;
  missingBlobsDescription: string[];
};
// Should not be called directly. Only exported for unit testing purposes
export function compareBlobsByRangeRequestAndResponse(
  blocks: WithBytes<SignedBeaconBlock>[],
  blobSidecars: deneb.BlobSidecars
): BlobComparisonResponse {
  let expectedBlobCount = 0;
  let missingBlobCount = 0;
  const missingBlobsDescription: string[] = [];
  for (const block of blocks) {
    const slot = block.data.message.slot;
    const expectedBlobs = (block.data as SignedBeaconBlock<ForkPostDeneb>).message.body.blobKzgCommitments.length;
    expectedBlobCount += expectedBlobs;
    const receivedBlobs = blobSidecars.filter((blobSidecar) => blobSidecar.signedBlockHeader.message.slot === slot);

    const missingIndices: number[] = [];
    for (const index of linspace(0, expectedBlobs - 1)) {
      if (!receivedBlobs.includes(index)) {
        missingIndices.push(index);
      }
    }
    if (missingIndices.length > 0) {
      missingBlobCount += missingIndices;
      missingBlobsDescription.push(`${slot}[${missingIndices.join(",")}]`);
    }
  }

  return {
    expectedBlobCount,
    missingBlobCount,
    missingBlobsDescription,
  };
}

type ColumnComparisonResponse = {
  missingByIndex: Map<number, Slot[]>;
  extraByIndex: Map<number, Slot[]>;
};
// Should not be called directly. Only exported for unit testing purposes
export function compareColumnsByRangeRequestAndResponse(
  columnRequest: fulu.DataColumnSidecarsByRangeRequest,
  columnSidecars: fulu.DataColumnSidecars
): ColumnComparisonResponse {
  const {startSlot, count, columns: expectedColumns} = columnRequest;

  const missingByIndex = new Map<number, Slot[]>();
  const extraByIndex = new Map<number, Slot[]>();

  for (let slot = startSlot; slot < startSlot + count; slot++) {
    const receivedIndices = columnSidecars
      .filter((columnSidecar) => columnSidecar.signedBlockHeader.message.slot === slot)
      .map((columnSidecar) => columnSidecar.index);

    for (const index of receivedIndices) {
      if (!expectedColumns.includes(index)) {
        const extraSlots = extraByIndex.get(index) ?? [];
        extraSlots.push(slot);
        extraByIndex.set(index, extraSlots);
      }
    }

    for (const index of expectedColumns) {
      if (!receivedIndices.includes(index)) {
        const missingSlots = missingByIndex.get(index) ?? [];
        missingSlots.push(slot);
        missingByIndex.set(index, missingSlots);
      }
    }
  }

  return {
    missingByIndex,
    extraByIndex,
  };
}

// Should not be called directly. Only exported for unit testing purposes
export function compareByRangeRequestsToResponse({
  slotRange,
  slotRangeString,
  blocksRequest,
  blobRequest,
  columnRequest,
  blocks,
  blobSidecars,
  columnSidecars,
}: DownloadByRangeRequests & DownloadByRangeResponses & {slotRange: number; slotRangeString: string}): void {
  const {missingSlots} = compareBlockByRangeRequestAndResponse(blocksRequest, blocks);

  if (missingSlots) {
    throw new DownloadByRangeError({
      code: DownloadByRangeErrorCode.MISSING_BLOCKS,
      missingSlots: `[ ${missingSlots.concat(",")} ]`,
    });
  }

  if (blobRequest) {
    if (!blobSidecars) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_BLOBS_RESPONSE,
        slotRange: slotRangeString,
      });
    }
    const {expectedBlobCount, missingBlobCount, missingBlobsDescription} = compareBlobsByRangeRequestAndResponse(
      blocks,
      blobSidecars
    );

    if (missingBlobCount > 0) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_BLOBS,
        expectedBlobCount,
        missingBlobCount,
        slotsWithIndices: missingBlobsDescription.join(","),
      });
    }
  }

  if (columnRequest) {
    if (!columnSidecars) {
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_COLUMNS_RESPONSE,
        slotRange: slotRangeString,
      });
    }
    const {missingByIndex, extraByIndex} = compareColumnsByRangeRequestAndResponse(columnRequest, columnSidecars);
    if (extraByIndex.size()) {
      throw new DownloadByRangeError({});
    }
    if (missingByIndex.size()) {
      const missingPeerCustody = [];
      let missingColumnCount = 0;
      const indicesWithSlots = [];
      for (const [index, missingSlots] of missingByIndex) {
        if (missingSlots.length === slotRange) {
          missingPeerCustody.push(index);
        } else {
          missingColumnCount += missingSlots;
          indicesWithSlots.push(`${index}[ ${missingSlots.join(",")} ]`);
        }
      }
      if (missingPeerCustody.length) {
        throw new DownloadByRangeError({code: DownloadByRangeErrorCode});
      }
      throw new DownloadByRangeError({
        code: DownloadByRangeErrorCode.MISSING_COLUMNS,
        missingColumnCount,
        indicesWithSlots: indicesWithSlots.join(", "),
      });
    }
  }
}
