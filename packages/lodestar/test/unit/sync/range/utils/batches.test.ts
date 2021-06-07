import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import {Epoch} from "@chainsafe/lodestar-types";
import {getValidPeerId} from "../../../../utils/peer";
import {Batch, BatchOpts, BatchStatus} from "../../../../../src/sync/range/batch";
import {
  validateBatchesStatus,
  getNextBatchToProcess,
  toBeProcessedStartEpoch,
  toBeDownloadedStartEpoch,
} from "../../../../../src/sync/range/utils/batches";

describe("sync / range / batches", () => {
  const opts: BatchOpts = {epochsPerBatch: 2};
  const peer = getValidPeerId();

  describe("validateBatchesStatus", () => {
    const testCases: {
      id: string;
      valid: boolean;
      batches: BatchStatus[];
    }[] = [
      {
        id: "Regular valid case",
        valid: true,
        batches: [
          BatchStatus.AwaitingValidation,
          BatchStatus.AwaitingValidation,
          BatchStatus.Processing,
          BatchStatus.Downloading,
          BatchStatus.AwaitingProcessing,
          BatchStatus.AwaitingDownload,
          BatchStatus.Downloading,
        ],
      },
      {
        id: "Empty, is valid",
        valid: true,
        batches: [],
      },
      {
        id: "Only AwaitingValidation, is valid",
        valid: true,
        batches: [BatchStatus.AwaitingValidation],
      },
      {
        id: "Only Processing, is valid",
        valid: true,
        batches: [BatchStatus.Processing],
      },
      {
        id: "Only PreProcessing, is valid",
        valid: true,
        batches: [BatchStatus.Downloading],
      },
      {
        id: "AwaitingValidation after Processing, not valid",
        valid: false,
        batches: [BatchStatus.Processing, BatchStatus.AwaitingValidation],
      },
      {
        id: "AwaitingValidation after PreProcessing, not valid",
        valid: false,
        batches: [BatchStatus.Downloading, BatchStatus.AwaitingValidation],
      },
      {
        id: "More than one Processing state, not valid",
        valid: false,
        batches: [BatchStatus.Processing, BatchStatus.Processing],
      },
      {
        id: "Processing after PreProcessing, not valid",
        valid: false,
        batches: [BatchStatus.Downloading, BatchStatus.Processing],
      },
    ];

    for (const {id, batches, valid} of testCases) {
      it(id, () => {
        const _batches = batches.map(createBatch);
        if (valid) {
          validateBatchesStatus(_batches);
        } else {
          expect(() => validateBatchesStatus(_batches)).to.throw();
        }
      });
    }
  });

  describe("getNextBatchToProcess", () => {
    const testCases: {
      id: string;
      batches: BatchStatus[];
      nextBatchToProcessIndex?: number;
    }[] = [
      {
        id: "Pick first one ready to process",
        batches: [
          BatchStatus.AwaitingValidation,
          BatchStatus.AwaitingValidation,
          BatchStatus.AwaitingProcessing, // <- pick [2]
          BatchStatus.AwaitingProcessing,
          BatchStatus.AwaitingDownload,
        ],
        nextBatchToProcessIndex: 2,
      },
      {
        id: "Already processing, return none",
        batches: [BatchStatus.AwaitingValidation, BatchStatus.Processing, BatchStatus.AwaitingProcessing],
      },
      {
        id: "Next batch is not ready to process, return none",
        batches: [BatchStatus.AwaitingValidation, BatchStatus.Downloading, BatchStatus.AwaitingProcessing],
      },
      {
        id: "Empty, return none",
        batches: [],
      },
    ];

    for (const {id, batches, nextBatchToProcessIndex} of testCases) {
      it(id, () => {
        const _batches = batches.map(createBatch);
        const nextBatchToProcess = getNextBatchToProcess(_batches);
        if (nextBatchToProcessIndex === undefined) {
          expect(nextBatchToProcess).to.equal(null);
        } else {
          expect(nextBatchToProcess).to.equal(_batches[nextBatchToProcessIndex]);
        }
      });
    }
  });

  describe("toBeProcessedStartEpoch", () => {
    const testCases: {
      id: string;
      batches: [Epoch, BatchStatus][];
      startEpoch: Epoch;
      result: Epoch;
    }[] = [
      {
        id: "Return next batch after AwaitingValidation-s",
        batches: [
          [0, BatchStatus.AwaitingValidation],
          [2, BatchStatus.AwaitingValidation],
          [4, BatchStatus.Processing],
          [6, BatchStatus.AwaitingDownload],
        ],
        startEpoch: 0,
        result: 4,
      },
      {
        id: "No AwaitingValidation, next to process is first batch",
        batches: [
          [4, BatchStatus.Processing],
          [6, BatchStatus.AwaitingDownload],
        ],
        startEpoch: 4,
        result: 4,
      },
      {
        id: "Empty, return startEpoch",
        batches: [],
        startEpoch: 0,
        result: 0,
      },
    ];

    for (const {id, batches, startEpoch, result} of testCases) {
      it(id, () => {
        const _batches = batches.map(([batchStartEpoch, batchStatus]) => createBatch(batchStatus, batchStartEpoch));
        expect(toBeProcessedStartEpoch(_batches, startEpoch, opts)).to.equal(result);
      });
    }
  });

  describe("toBeDownloadedStartEpoch", () => {
    const testCases: {
      id: string;
      batches: [Epoch, BatchStatus][];
      startEpoch: Epoch;
      result: Epoch;
    }[] = [
      {
        id: "Regular case, pick the next available spot",
        batches: [
          [0, BatchStatus.AwaitingValidation],
          [2, BatchStatus.AwaitingValidation],
          [4, BatchStatus.Processing],
          [6, BatchStatus.AwaitingDownload],
        ],
        startEpoch: 0,
        result: 8,
      },
      {
        id: "Empty, return startEpoch",
        batches: [],
        startEpoch: 0,
        result: 0,
      },
    ];

    for (const {id, batches, startEpoch, result} of testCases) {
      it(id, () => {
        const _batches = batches.map(([batchStartEpoch, batchStatus]) => createBatch(batchStatus, batchStartEpoch));
        expect(toBeDownloadedStartEpoch(_batches, startEpoch, opts)).to.equal(result);
      });
    }
  });

  function createBatch(status: BatchStatus, startEpoch = 0): Batch {
    const batch = new Batch(startEpoch, config, opts);

    if (status === BatchStatus.AwaitingDownload) return batch;

    batch.startDownloading(peer);
    if (status === BatchStatus.Downloading) return batch;

    batch.downloadingSuccess([]);
    if (status === BatchStatus.AwaitingProcessing) return batch;

    batch.startProcessing();
    if (status === BatchStatus.Processing) return batch;

    batch.processingSuccess();
    if (status === BatchStatus.AwaitingValidation) return batch;
    throw Error(`Unknown status: ${status}`);
  }
});
