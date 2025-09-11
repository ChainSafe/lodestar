import {generateKeyPair} from "@libp2p/crypto/keys";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BlockInputPreData} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {computeNodeIdFromPrivateKey} from "../../../../src/network/subnets/index.js";
import {Batch, BatchError, BatchErrorCode, BatchStatus} from "../../../../src/sync/range/batch.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {clock, config} from "../../../utils/blocksAndData.js";
import {expectThrowsLodestarError} from "../../../utils/errors.js";
import {validPeerIdStr} from "../../../utils/peer.js";

/**
 * Should not be called directly. Only exported for unit testing purposes
 */
// export function validateRequests({
//   config,
//   daOutOfRange,
//   blocksRequest,
//   blobsRequest,
//   columnsRequest,
// }: DownloadByRangeRequests & Pick<DownloadAndCacheByRangeProps, "config" | "daOutOfRange">): string {
//   const startSlot = (blocksRequest?.startSlot ?? blobsRequest?.startSlot ?? columnsRequest?.startSlot) as number;
//   const count = (blocksRequest?.count ?? blobsRequest?.count ?? columnsRequest?.count) as number;
//   const slotRange = `${startSlot} - ${startSlot + count}`;
//   const dataRequest = blobsRequest ?? columnsRequest;

//   if (!blocksRequest) {
//     throw new DownloadByRangeError({
//       code: DownloadByRangeErrorCode.MISSING_BLOCKS_REQUEST,
//       slotRange,
//     });
//   }

//   if (daOutOfRange) {
//     if (dataRequest) {
//       throw new DownloadByRangeError(
//         {
//           code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
//           slotRange,
//         },
//         "Cannot request data if it is outside of the availability range"
//       );
//     }

//     return slotRange;
//   }

//   if (!dataRequest) {
//     throw new DownloadByRangeError(
//       {
//         code: DownloadByRangeErrorCode.MISSING_DATA_REQUEST,
//         slotRange,
//       },
//       "Must request data if it is available"
//     );
//   }

//   if (blobsRequest && columnsRequest) {
//     throw new DownloadByRangeError(
//       {
//         code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
//         slotRange,
//       },
//       "Cannot request both blob and column data in the same slot range"
//     );
//   }

//   const forkName = config.getForkName(startSlot);
//   if (!isForkPostDeneb(forkName)) {
//     throw new DownloadByRangeError(
//       {
//         code: DownloadByRangeErrorCode.INVALID_DATA_REQUEST,
//         slotRange,
//       },
//       "Cannot request data pre-deneb"
//     );
//   }

//   if (isForkPostDeneb(forkName) && !isForkPostFulu(forkName) && !blobsRequest) {
//     throw new DownloadByRangeError(
//       {
//         code: DownloadByRangeErrorCode.MISSING_BLOBS_REQUEST,
//         slotRange,
//       },
//       "Must request blobs for blob-only forks"
//     );
//   }

//   if (isForkPostFulu(forkName) && !columnsRequest) {
//     throw new DownloadByRangeError(
//       {
//         code: DownloadByRangeErrorCode.MISSING_COLUMNS_REQUEST,
//         slotRange,
//       },
//       "Must request columns for forks with columns"
//     );
//   }

//   if (blocksRequest.startSlot !== dataRequest.startSlot) {
//     throw new DownloadByRangeError({
//       code: DownloadByRangeErrorCode.START_SLOT_MISMATCH,
//       blockStartSlot: blocksRequest.startSlot,
//       dataStartSlot: dataRequest.startSlot,
//     });
//   }

//   if (blocksRequest.count !== dataRequest.count) {
//     throw new DownloadByRangeError({
//       code: DownloadByRangeErrorCode.COUNT_MISMATCH,
//       blockCount: blocksRequest.count,
//       dataCount: dataRequest.count,
//     });
//   }

//   return slotRange;
// }

describe("sync / range / batch", async () => {
  // Common mock data
  const privateKey = await generateKeyPair("secp256k1");
  const nodeId = computeNodeIdFromPrivateKey(privateKey);
  const custodyConfig = new CustodyConfig({config, nodeId});
  const peer = validPeerIdStr;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getRequests", () => {
    describe("PreDeneb", () => {
      let batch: Batch;
      const startEpoch = config.CAPELLA_FORK_EPOCH + 1;

      it("should make default pre-deneb requests if no existing blocks are passed", () => {
        batch = new Batch(startEpoch, config, clock, custodyConfig);
        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toBeUndefined();
      });

      it("should have correct start slot to not re-download blocks", () => {});
    });

    describe("ForkDABlobs", () => {
      let batch: Batch;
      const startEpoch = config.DENEB_FORK_EPOCH + 1;

      it("should make default ForkDABlobs requests if no existing blocks are passed", () => {
        batch = new Batch(startEpoch, config, clock, custodyConfig);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toEqual({startSlot: batch.startSlot, count: batch.count});
        expect(batch.requests.columnsRequest).toBeUndefined();
      });

      it("should make default ForkDABlobs requests if current epoch is the last in request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toEqual({startSlot: batch.startSlot, count: batch.count});
        expect(batch.requests.columnsRequest).toBeUndefined();
      });

      it("should not make ForkDABlobs requests if current epoch is ahead of request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS + 1
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toBeUndefined();
      });
    });

    describe("ForkDAColumns", () => {
      let batch: Batch;
      const startEpoch = config.FULU_FORK_EPOCH + 1;

      beforeEach(() => {
        batch = new Batch(startEpoch, config, clock, custodyConfig);
      });

      it("should make ForkDAColumns requests if no existing blocks are passed", () => {
        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toEqual({
          startSlot: batch.startSlot,
          count: batch.count,
          columns: custodyConfig.sampledColumns,
        });
      });

      it("should make ForkDAColumns requests if current epoch is the last in request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toEqual({
          startSlot: batch.startSlot,
          count: batch.count,
          columns: custodyConfig.sampledColumns,
        });
      });

      it("should not make ForkDAColumns if current epoch is the last in request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS + 1
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toBeUndefined();
      });
    });

    it("should not request data pre-deneb", () => {
      const startEpoch = config.CAPELLA_FORK_EPOCH - 1;
      const batch = new Batch(startEpoch, config, clock, custodyConfig);
      expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
      expect(batch.requests.blobsRequest).toBeUndefined();
      expect(batch.requests.columnsRequest).toBeUndefined();
    });

    it("should not request data when before availability window", () => {});

    // it("should request data within availability window", () => {});

    // it("should only request blobs or columns, not both", () => {});

    // it("should request blobs between post-deneb and pre-fulu ", () => {});

    it("should request columns post-fulu", () => {
      const startEpoch = config.FULU_FORK_EPOCH + 1;
      const batch = new Batch(startEpoch, config, clock, custodyConfig);
      expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
      expect(batch.requests.blobsRequest).toBeUndefined();
      expect(batch.requests.columnsRequest).toEqual({
        startSlot: batch.startSlot,
        count: batch.count,
        columns: custodyConfig.sampledColumns,
      });
    });

    it("should have same start slot and count for blocks and data requests", () => {
      const startEpoch = config.FULU_FORK_EPOCH + 1;
      const batch = new Batch(startEpoch, config, clock, custodyConfig);
      expect(batch.requests.blocksRequest?.startSlot).toEqual(batch.requests.columnsRequest?.startSlot);
      expect(batch.requests.blocksRequest?.count).toEqual(batch.requests.columnsRequest?.count);
    });
  });

  describe("downloadingSuccess", () => {
    it("should handle blocks that are not in slot-wise order", () => {});
  });

  it("Complete state flow", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig);

    // Instantion: AwaitingDownload
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // startDownloading: AwaitingDownload -> Downloading
    batch.startDownloading(peer);
    expect(batch.state.status).toBe(BatchStatus.Downloading);

    // downloadingError: Downloading -> AwaitingDownload
    batch.downloadingError(peer);
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);
    expect(batch.getFailedPeers()[0]).toBe(peer);

    // As of https://github.com/ChainSafe/lodestar/pull/8150, we abort the batch after a single processing error
    // commented out the rest of the flow for now

    // retry download: AwaitingDownload -> Downloading
    // downloadingSuccess: Downloading -> AwaitingProcessing
    batch.startDownloading(peer);
    batch.downloadingSuccess(peer, [
      BlockInputPreData.createFromBlock({
        block: ssz.capella.SignedBeaconBlock.defaultValue(),
        blockRootHex: "0x1234",
        source: BlockInputSource.byRoot,
        seenTimestampSec: Date.now() / 1000,
        forkName: ForkName.capella,
        daOutOfRange: false,
      }),
    ]);
    expect(batch.state.status).toBe(BatchStatus.AwaitingProcessing);

    // startProcessing: AwaitingProcessing -> Processing
    // const blocksToProcess = batch.startProcessing();
    // expect(batch.state.status).toBe(BatchStatus.Processing);
    // expect(blocksToProcess).toBe(blocksDownloaded);

    // processingError: Processing -> AwaitingDownload

    // batch.processingError(new Error());
    // expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // retry download + processing: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing
    // processingSuccess: Processing -> AwaitingValidation
    // batch.startDownloading(peer);
    // batch.downloadingSuccess({blocks: blocksDownloaded, pendingDataColumns: null});
    // batch.startProcessing();
    // batch.processingSuccess();
    // expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);

    // validationError: AwaitingValidation -> AwaitingDownload

    // batch.validationError(new Error());
    // expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // retry download + processing + validation: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing -> AwaitingValidation
    // batch.startDownloading(peer);
    // batch.downloadingSuccess({blocks: blocksDownloaded, pendingDataColumns: null});
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);
    // On validationSuccess() the batch will just be dropped and garbage collected
  });

  it("Should throw on inconsistent state - downloadingSuccess", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig);

    expectThrowsLodestarError(
      () => batch.downloadingSuccess(peer, []),
      new BatchError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.Downloading,
      })
    );
  });

  it("Should throw on inconsistent state - startProcessing", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig);

    expectThrowsLodestarError(
      () => batch.startProcessing(),
      new BatchError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.AwaitingProcessing,
      })
    );
  });

  it("Should throw on inconsistent state - processingSuccess", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig);

    expectThrowsLodestarError(
      () => batch.processingSuccess(),
      new BatchError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.Processing,
      })
    );
  });
});
