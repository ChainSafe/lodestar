import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  BlockInputColumns,
  BlockInputNoData,
  BlockInputPreData,
} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {computeNodeIdFromPrivateKey} from "../../../../src/network/subnets/index.js";
import {Batch, BatchError, BatchErrorCode, BatchStatus} from "../../../../src/sync/range/batch.js";
import {getBatchSlotRange} from "../../../../src/sync/range/utils/index.js";
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
  const peerSyncMeta = {peerId: peer, client: "lodestar", custodyColumns: custodyConfig.sampledColumns};

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getRequests", () => {
    describe("PreDeneb", () => {
      let batch: Batch;
      const startEpoch = config.CAPELLA_FORK_EPOCH + 1;

      it("should make default pre-deneb requests if no existing blocks are passed", () => {
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
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
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toEqual({startSlot: batch.startSlot, count: batch.count});
        expect(batch.requests.columnsRequest).toBeUndefined();
      });

      it("should make default ForkDABlobs requests if current epoch is the last in request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toEqual({startSlot: batch.startSlot, count: batch.count});
        expect(batch.requests.columnsRequest).toBeUndefined();
      });

      it("should not make ForkDABlobs requests if current epoch is ahead of request range", () => {
        vi.spyOn(clock, "currentEpoch", "get").mockReturnValue(
          startEpoch + config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS + 1
        );
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toBeUndefined();
      });
    });

    describe("ForkDAColumns", () => {
      let batch: Batch;
      const startEpoch = config.FULU_FORK_EPOCH + 1;

      beforeEach(() => {
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
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
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

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
        batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

        expect(batch.requests.blocksRequest).toEqual({startSlot: batch.startSlot, count: batch.count, step: 1});
        expect(batch.requests.blobsRequest).toBeUndefined();
        expect(batch.requests.columnsRequest).toBeUndefined();
      });
    });

    it("should not request data pre-deneb", () => {
      const startEpoch = config.CAPELLA_FORK_EPOCH - 1;
      const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
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
      const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
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
      const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
      expect(batch.requests.blocksRequest?.startSlot).toEqual(batch.requests.columnsRequest?.startSlot);
      expect(batch.requests.blocksRequest?.count).toEqual(batch.requests.columnsRequest?.count);
    });
  });

  describe("downloadingSuccess", () => {
    it("should handle blocks that are not in slot-wise order", () => {});

    describe("post-Gloas", () => {
      const startEpoch = config.GLOAS_FORK_EPOCH + 1;
      const seenTimestampSec = Date.now() / 1000;

      function buildGloasBlockWithEnvelope({
        slot,
        blobCount = 0,
        sampledColumns = [],
        addEnvelope = true,
        addAllColumns = true,
      }: {
        slot: number;
        blobCount?: number;
        sampledColumns?: number[];
        addEnvelope?: boolean;
        addAllColumns?: boolean;
      }): {blockInput: BlockInputNoData; payloadInput: PayloadEnvelopeInput} {
        const block = ssz.gloas.SignedBeaconBlock.defaultValue();
        block.message.slot = slot;
        block.message.body.signedExecutionPayloadBid.message.blobKzgCommitments = Array.from({length: blobCount}, () =>
          Buffer.alloc(48, 0x11)
        );
        const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
        const blockRootHex = toRootHex(blockRoot);
        const blockInput = BlockInputNoData.createFromBlock({
          block: block as SignedBeaconBlock<typeof ForkName.gloas>,
          blockRootHex,
          forkName: ForkName.gloas,
          daOutOfRange: false,
          seenTimestampSec,
          source: BlockInputSource.byRange,
          peerIdStr: peer,
        });
        const payloadInput = PayloadEnvelopeInput.createFromBlock({
          blockRootHex,
          block: block as SignedBeaconBlock<typeof ForkName.gloas>,
          forkName: ForkName.gloas,
          sampledColumns,
          custodyColumns: sampledColumns,
          timeCreatedSec: seenTimestampSec,
          daOutOfRange: false,
        });
        if (addEnvelope) {
          const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
          envelope.message.beaconBlockRoot = blockRoot;
          envelope.message.payload.slotNumber = slot;
          payloadInput.addPayloadEnvelope({
            envelope,
            source: PayloadEnvelopeInputSource.byRange,
            seenTimestampSec,
            peerIdStr: peer,
          });
        }
        if (addAllColumns && sampledColumns.length > 0) {
          for (const index of sampledColumns) {
            const columnSidecar = ssz.gloas.DataColumnSidecar.defaultValue();
            columnSidecar.beaconBlockRoot = blockRoot;
            columnSidecar.slot = slot;
            columnSidecar.index = index;
            payloadInput.addColumn({
              columnSidecar,
              source: PayloadEnvelopeInputSource.byRange,
              seenTimestampSec,
              peerIdStr: peer,
            });
          }
        }
        return {blockInput, payloadInput};
      }

      it("transitions to AwaitingProcessing when every block has a complete payload envelope", () => {
        const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        batch.startDownloading(peerSyncMeta);

        const {blockInput: bi1, payloadInput: pi1} = buildGloasBlockWithEnvelope({slot: batch.startSlot});
        const {blockInput: bi2, payloadInput: pi2} = buildGloasBlockWithEnvelope({slot: batch.startSlot + 1});
        const payloadEnvelopes = new Map([
          [bi1.slot, pi1],
          [bi2.slot, pi2],
        ]);

        batch.downloadingSuccess(peer, [bi1, bi2], payloadEnvelopes);

        expect(batch.state.status).toBe(BatchStatus.AwaitingProcessing);
      });

      it("transitions to AwaitingProcessing when a block has no payload envelope (EMPTY variant)", () => {
        // Regression test for https://github.com/ChainSafe/lodestar/issues/9357
        // For post-Gloas, a block without an envelope is a valid EMPTY-variant slot. The download
        // path cannot distinguish "EMPTY" from "peer doesn't have the envelope", so we accept it
        // as complete here and let `assertLinearChainSegment` (run during processing with the real
        // parent execution hash) decide whether the variant is correct.
        const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        batch.startDownloading(peerSyncMeta);

        const {blockInput: bi1, payloadInput: pi1} = buildGloasBlockWithEnvelope({slot: batch.startSlot});
        const {blockInput: bi2} = buildGloasBlockWithEnvelope({slot: batch.startSlot + 1, addEnvelope: false});
        const payloadEnvelopes = new Map([[bi1.slot, pi1]]);

        batch.downloadingSuccess(peer, [bi1, bi2], payloadEnvelopes);

        expect(batch.state.status).toBe(BatchStatus.AwaitingProcessing);
      });

      it("transitions to AwaitingProcessing for count=1 with only the block (no envelope)", () => {
        // The exact scenario from #9357: count=1 batch, peer returns block but no envelope.
        const {startSlot} = getBatchSlotRange(startEpoch);
        const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, startSlot);
        expect(batch.count).toBe(1);
        batch.startDownloading(peerSyncMeta);

        const {blockInput: bi1} = buildGloasBlockWithEnvelope({slot: batch.startSlot, addEnvelope: false});

        batch.downloadingSuccess(peer, [bi1], null);

        expect(batch.state.status).toBe(BatchStatus.AwaitingProcessing);
      });

      it("stays AwaitingDownload when a payload envelope is missing sampled columns", () => {
        const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        batch.startDownloading(peerSyncMeta);

        const sampledColumns = [0, 1];
        const {blockInput: bi1, payloadInput: pi1} = buildGloasBlockWithEnvelope({
          slot: batch.startSlot,
          blobCount: 1,
          sampledColumns,
          addAllColumns: true,
        });
        // Envelope received but its sampled columns were not
        const {blockInput: bi2, payloadInput: pi2} = buildGloasBlockWithEnvelope({
          slot: batch.startSlot + 1,
          blobCount: 1,
          sampledColumns,
          addAllColumns: false,
        });
        const payloadEnvelopes = new Map([
          [bi1.slot, pi1],
          [bi2.slot, pi2],
        ]);

        batch.downloadingSuccess(peer, [bi1, bi2], payloadEnvelopes);

        expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);
        expect(batch.requests.columnsRequest).toBeDefined();
        // Re-request must start at the slot whose payload is missing columns,
        // and only include the missing column indices.
        expect(batch.requests.columnsRequest?.startSlot).toBe(bi2.slot);
        expect(batch.requests.columnsRequest?.columns).toEqual(sampledColumns);
      });
    });

    describe("Fulu (pre-Gloas)", () => {
      const startEpoch = config.FULU_FORK_EPOCH + 1;
      const seenTimestampSec = Date.now() / 1000;

      it("stays AwaitingDownload when reconstruction threshold reached but sampled columns missing", () => {
        const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);
        batch.startDownloading(peerSyncMeta);

        // Pick sampled indices outside the range we'll fill so they stay physically missing
        const sampledColumns = [100, 101, 102, 103];
        const block = ssz.fulu.SignedBeaconBlock.defaultValue();
        block.message.slot = batch.startSlot;
        block.message.body.blobKzgCommitments = [Buffer.alloc(48, 0x11)];
        const blockRoot = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
        const blockRootHex = toRootHex(blockRoot);

        const blockInput = BlockInputColumns.createFromBlock({
          block: block as SignedBeaconBlock<typeof ForkName.fulu>,
          blockRootHex,
          forkName: ForkName.fulu,
          daOutOfRange: false,
          seenTimestampSec,
          source: BlockInputSource.byRange,
          peerIdStr: peer,
          sampledColumns,
          custodyColumns: sampledColumns,
        });

        // Add NUMBER_OF_COLUMNS/2 columns at non-sampled indices (0..63) to hit the
        // reconstruction threshold without any sampled column being physically present.
        for (let i = 0; i < 64; i++) {
          const columnSidecar = ssz.fulu.DataColumnSidecar.defaultValue();
          columnSidecar.index = i;
          blockInput.addColumn({
            columnSidecar,
            blockRootHex,
            source: BlockInputSource.byRange,
            seenTimestampSec,
            peerIdStr: peer,
          });
        }

        // Reconstruction-threshold semantics: hasAllData true, hasComputedAllData false.
        expect(blockInput.hasAllData()).toBe(true);
        expect(blockInput.hasComputedAllData()).toBe(false);

        batch.downloadingSuccess(peer, [blockInput], null);

        expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);
        expect(batch.requests.columnsRequest).toBeDefined();
        expect(batch.requests.columnsRequest?.startSlot).toBe(batch.startSlot);
        expect(batch.requests.columnsRequest?.columns.slice().sort((a, b) => a - b)).toEqual(sampledColumns);
      });
    });
  });

  it("Complete state flow", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

    // Instantion: AwaitingDownload
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // startDownloading: AwaitingDownload -> Downloading
    batch.startDownloading(peerSyncMeta);
    expect(batch.state.status).toBe(BatchStatus.Downloading);

    // downloadingError: Downloading -> AwaitingDownload
    batch.downloadingError(peer);
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);
    expect(batch.getFailedPeers()[0]).toBe(peer);

    // As of https://github.com/ChainSafe/lodestar/pull/8150, we abort the batch after a single processing error
    // commented out the rest of the flow for now

    // retry download: AwaitingDownload -> Downloading
    // downloadingSuccess: Downloading -> AwaitingProcessing
    batch.startDownloading(peerSyncMeta);
    batch.downloadingSuccess(
      peer,
      [
        BlockInputPreData.createFromBlock({
          block: ssz.capella.SignedBeaconBlock.defaultValue(),
          blockRootHex: "0x1234",
          source: BlockInputSource.byRoot,
          seenTimestampSec: Date.now() / 1000,
          forkName: ForkName.capella,
          daOutOfRange: false,
        }),
      ],
      null
    );
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
    // batch.startDownloading(peerSyncMeta);
    // batch.downloadingSuccess({blocks: blocksDownloaded, pendingDataColumns: null});
    // batch.startProcessing();
    // batch.processingSuccess();
    // expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);

    // validationError: AwaitingValidation -> AwaitingDownload

    // batch.validationError(new Error());
    // expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // retry download + processing + validation: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing -> AwaitingValidation
    // batch.startDownloading(peerSyncMeta);
    // batch.downloadingSuccess({blocks: blocksDownloaded, pendingDataColumns: null});
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);
    // On validationSuccess() the batch will just be dropped and garbage collected
  });

  it("Should throw on inconsistent state - downloadingSuccess", () => {
    const startEpoch = 0;
    const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

    expectThrowsLodestarError(
      () => batch.downloadingSuccess(peer, [], null),
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
    const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

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
    const batch = new Batch(startEpoch, config, clock, custodyConfig, false, undefined, Number.MAX_SAFE_INTEGER);

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
