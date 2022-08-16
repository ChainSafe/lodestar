import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {Epoch, Slot} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getValidPeerId} from "../../../../utils/peer.js";
import {Batch, BatchStatus} from "../../../../../src/sync/range/batch.js";
import {
  validateBatchesStatus,
  getNextBatchToProcess,
  isSyncChainDone,
  toBeDownloadedStartEpoch,
} from "../../../../../src/sync/range/utils/batches.js";

describe("sync / range / batches", () => {
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

  describe("isSyncChainDone", () => {
    const testCases: {
      id: string;
      batches: [Epoch, BatchStatus][];
      latestValidatedEpoch: Epoch;
      targetSlot: Slot;
      isDone: boolean;
    }[] = [
      {
        id: "Latest AwaitingValidation is beyond target",
        batches: [
          [0, BatchStatus.AwaitingValidation],
          [1, BatchStatus.AwaitingValidation],
          [2, BatchStatus.Processing],
          [3, BatchStatus.AwaitingDownload],
        ],
        latestValidatedEpoch: 0,
        targetSlot: 1 * SLOTS_PER_EPOCH, // = Last AwaitingValidation
        isDone: true,
      },
      {
        id: "latestValidatedEpoch is beyond target",
        batches: [
          [4, BatchStatus.Processing],
          [5, BatchStatus.AwaitingDownload],
        ],
        latestValidatedEpoch: 3,
        targetSlot: 2 * SLOTS_PER_EPOCH, // Previous to
        isDone: true,
      },
      {
        id: "No batches not done",
        batches: [],
        latestValidatedEpoch: 0,
        targetSlot: 1 * SLOTS_PER_EPOCH,
        isDone: false,
      },
      {
        id: "Zero case, not done",
        batches: [],
        latestValidatedEpoch: 0,
        targetSlot: 0 * SLOTS_PER_EPOCH,
        isDone: false,
      },
    ];

    for (const {id, batches, latestValidatedEpoch, targetSlot, isDone} of testCases) {
      it(id, () => {
        const _batches = batches.map(([batchStartEpoch, batchStatus]) => createBatch(batchStatus, batchStartEpoch));
        expect(isSyncChainDone(_batches, latestValidatedEpoch, targetSlot)).to.equal(isDone);
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
          [1, BatchStatus.AwaitingValidation],
          [2, BatchStatus.Processing],
          [3, BatchStatus.AwaitingDownload],
        ],
        startEpoch: 0,
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
        expect(toBeDownloadedStartEpoch(_batches, startEpoch)).to.equal(result);
      });
    }
  });

  function createBatch(status: BatchStatus, startEpoch = 0): Batch {
    const batch = new Batch(startEpoch, config);

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
