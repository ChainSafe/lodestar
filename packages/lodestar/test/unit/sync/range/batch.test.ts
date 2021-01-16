import {expect} from "chai";
import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/minimal";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {silentLogger} from "../../../utils/logger";
import {generateEmptySignedBlock} from "../../../utils/block";
import {expectThrowsLodestarError} from "../../../utils/errors";
import {Batch, BatchStatus, WrongStateError, BatchErrorCode} from "../../../../src/sync/range/batch";

const debugMode = process.env.DEBUG;

describe("sync / range / batch", () => {
  const EPOCHS_PER_BATCH = 2;
  const logger = debugMode ? new WinstonLogger({level: LogLevel.verbose, module: "SYNC"}) : silentLogger;

  // Common mock data
  const startEpoch = 0;
  const peer = new PeerId(Buffer.from("lodestar"));
  const blocksDownloaded = [generateEmptySignedBlock()];

  it("Should return correct blockByRangeRequest", () => {
    const batch = new Batch(startEpoch, EPOCHS_PER_BATCH, config, logger);
    expect(batch.request).to.deep.equal({
      startSlot: 1,
      count: config.params.SLOTS_PER_EPOCH * EPOCHS_PER_BATCH,
      step: 1,
    });
  });

  it("Complete state flow", () => {
    const batch = new Batch(startEpoch, EPOCHS_PER_BATCH, config, logger);

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
    batch.processingError();
    expect(batch.state.status).to.equal(BatchStatus.AwaitingDownload, "Wrong status on processingError");

    // retry download + processing: AwaitingDownload -> Downloading -> AwaitingProcessing -> Processing
    // processingSuccess: Processing -> AwaitingValidation
    batch.startDownloading(peer);
    batch.downloadingSuccess(blocksDownloaded);
    batch.startProcessing();
    batch.processingSuccess();
    expect(batch.state.status).to.equal(BatchStatus.AwaitingValidation, "Wrong status on processingSuccess");

    // validationError: AwaitingValidation -> AwaitingDownload
    batch.validationError();
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
    const batch = new Batch(startEpoch, EPOCHS_PER_BATCH, config, logger);

    expectThrowsLodestarError(
      () => batch.downloadingSuccess(blocksDownloaded),
      new WrongStateError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.Downloading,
      })
    );
  });

  it("Should throw on inconsistent state - startProcessing", () => {
    const batch = new Batch(startEpoch, EPOCHS_PER_BATCH, config, logger);

    expectThrowsLodestarError(
      () => batch.startProcessing(),
      new WrongStateError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.AwaitingProcessing,
      })
    );
  });

  it("Should throw on inconsistent state - processingSuccess", () => {
    const batch = new Batch(startEpoch, EPOCHS_PER_BATCH, config, logger);

    expectThrowsLodestarError(
      () => batch.processingSuccess(),
      new WrongStateError({
        code: BatchErrorCode.WRONG_STATUS,
        startEpoch,
        status: BatchStatus.AwaitingDownload,
        expectedStatus: BatchStatus.Processing,
      })
    );
  });
});
