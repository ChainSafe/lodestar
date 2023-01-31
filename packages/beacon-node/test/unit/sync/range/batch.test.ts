import {expect} from "chai";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {expectThrowsLodestarError} from "../../../utils/errors.js";
import {Batch, BatchStatus, BatchErrorCode, BatchError} from "../../../../src/sync/range/batch.js";
import {EPOCHS_PER_BATCH} from "../../../../src/sync/constants.js";
import {getBlockInput} from "../../../../src/chain/blocks/types.js";

describe("sync / range / batch", async () => {
  // Common mock data
  const startEpoch = 0;
  const peer = await createSecp256k1PeerId();
  const blocksDownloaded = [getBlockInput.preDeneb(config, ssz.phase0.SignedBeaconBlock.defaultValue())];

  it("Should return correct blockByRangeRequest", () => {
    const batch = new Batch(startEpoch, config);
    expect(batch.request).to.deep.equal({
      startSlot: 0,
      count: SLOTS_PER_EPOCH * EPOCHS_PER_BATCH,
      step: 1,
    });
  });

  it("Complete state flow", () => {
    const batch = new Batch(startEpoch, config);

    // Instantion: AwaitingDownload
    expect(batch.state.status).to.equal(BatchStatus.AwaitingDownload, "Wrong status on instantiation");

    // startDownloading: AwaitingDownload -> Downloading
    batch.startDownloading(peer);
    expect(batch.state.status).to.equal(BatchStatus.Downloading, "Wrong status on startDownloading");

    // downloadingError: Downloading -> AwaitingDownload
    batch.downloadingError();
    expect(batch.state.status).to.equal(BatchStatus.AwaitingDownload, "Wrong status on downloadingError");
    expect(batch.getFailedPeers()[0]).to.equal(peer, "getFailedPeers must returned peer from previous request");

    // retry download: AwaitingDownload -> Downloading
    // downloadingSuccess: Downloading -> AwaitingProcessing
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    expect(batch.state.status).to.equal(BatchStatus.AwaitingProcessing, "Wrong status on downloadingSuccess");

    // startProcessing: AwaitingProcessing -> Processing
    const blocksToProcess = batch.startProcessing();
    expect(batch.state.status).to.equal(BatchStatus.Processing, "Wrong status on startProcessing");
    expect(blocksToProcess).to.equal(blocksDownloaded, "Blocks to process should be the same downloaded");

    // processingError: Processing -> AwaitingDownload
    batch.processingError(new Error());
    expect(batch.state.status).to.equal(BatchStatus.AwaitingDownload, "Wrong status on processingError");

    // retry download + processing: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing
    // processingSuccess: Processing -> AwaitingValidation
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).to.equal(BatchStatus.AwaitingValidation, "Wrong status on processingSuccess");

    // validationError: AwaitingValidation -> AwaitingDownload
    batch.validationError(new Error());
    expect(batch.state.status).to.equal(BatchStatus.AwaitingDownload, "Wrong status on validationError");

    // retry download + processing + validation: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing -> AwaitingValidation
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).to.equal(BatchStatus.AwaitingValidation, "Wrong status on final processingSuccess");
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
