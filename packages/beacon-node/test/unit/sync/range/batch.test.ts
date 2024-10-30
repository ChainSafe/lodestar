import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {BlockSource, getBlockInput} from "../../../../src/chain/blocks/types.js";
import {EPOCHS_PER_BATCH} from "../../../../src/sync/constants.js";
import {Batch, BatchError, BatchErrorCode, BatchStatus} from "../../../../src/sync/range/batch.js";
import {expectThrowsLodestarError} from "../../../utils/errors.js";
import {validPeerIdStr} from "../../../utils/peer.js";
describe("sync / range / batch", () => {
  // Common mock data
  const startEpoch = 0;
  const peer = validPeerIdStr;
  const blocksDownloaded = [
    getBlockInput.preData(config, ssz.phase0.SignedBeaconBlock.defaultValue(), BlockSource.byRange, null),
  ];

  it("Should return correct blockByRangeRequest", () => {
    const batch = new Batch(startEpoch, config);
    expect(batch.request).toEqual({
      startSlot: 0,
      count: SLOTS_PER_EPOCH * EPOCHS_PER_BATCH,
      step: 1,
    });
  });

  it("Complete state flow", () => {
    const batch = new Batch(startEpoch, config);

    // Instantion: AwaitingDownload
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // startDownloading: AwaitingDownload -> Downloading
    batch.startDownloading(peer);
    expect(batch.state.status).toBe(BatchStatus.Downloading);

    // downloadingError: Downloading -> AwaitingDownload
    batch.downloadingError();
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);
    expect(batch.getFailedPeers()[0]).toBe(peer);

    // retry download: AwaitingDownload -> Downloading
    // downloadingSuccess: Downloading -> AwaitingProcessing
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    expect(batch.state.status).toBe(BatchStatus.AwaitingProcessing);

    // startProcessing: AwaitingProcessing -> Processing
    const blocksToProcess = batch.startProcessing();
    expect(batch.state.status).toBe(BatchStatus.Processing);
    expect(blocksToProcess).toBe(blocksDownloaded);

    // processingError: Processing -> AwaitingDownload
    batch.processingError(new Error());
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // retry download + processing: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing
    // processingSuccess: Processing -> AwaitingValidation
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);

    // validationError: AwaitingValidation -> AwaitingDownload
    batch.validationError(new Error());
    expect(batch.state.status).toBe(BatchStatus.AwaitingDownload);

    // retry download + processing + validation: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing -> AwaitingValidation
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).toBe(BatchStatus.AwaitingValidation);
    // On validationSuccess() the batch will just be dropped and garbage collected
  });

  it("Should throw on inconsistent state - downloadingSuccess", () => {
    const batch = new Batch(startEpoch, config);

    expectThrowsLodestarError(
      () => batch.downloadingSuccess(blocksDownloaded),
      new BatchError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.Downloading,
      })
    );
  });

  it("Should throw on inconsistent state - startProcessing", () => {
    const batch = new Batch(startEpoch, config);

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
    const batch = new Batch(startEpoch, config);

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
