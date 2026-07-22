import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, Slot, ssz} from "@lodestar/types";
import {IBlockInput} from "../../../../../src/chain/blocks/blockInput/types.js";
import {BlockError, BlockErrorCode} from "../../../../../src/chain/errors/index.js";
import {Batch, BatchStatus} from "../../../../../src/sync/range/batch.js";
import {
  ProcessingFaultKind,
  classifyProcessingFault,
  getNextBatchToProcess,
  isSyncChainDone,
  toBeDownloadedStartEpoch,
  validateBatchesStatus,
} from "../../../../../src/sync/range/utils/batches.js";
import {CustodyConfig} from "../../../../../src/util/dataColumns.js";
import {clock} from "../../../../utils/blocksAndData.js";
import {validPeerIdStr} from "../../../../utils/peer.js";

describe("sync / range / batches", () => {
  const peer = validPeerIdStr;
  const peerSyncMeta = {peerId: peer, client: "lodestar", custodyColumns: []};

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
          expect(() => validateBatchesStatus(_batches)).toThrow();
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
          expect(nextBatchToProcess).toBe(null);
        } else {
          expect(nextBatchToProcess).toBe(_batches[nextBatchToProcessIndex]);
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
        expect(isSyncChainDone(_batches, latestValidatedEpoch, targetSlot)).toBe(isDone);
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
        expect(toBeDownloadedStartEpoch(_batches, startEpoch)).toBe(result);
      });
    }
  });

  describe("classifyProcessingFault", () => {
    function fakeBatch(startSlot: Slot, blockSlots: Slot[] = [], payloadSlots: Slot[] = []): Batch {
      return {
        startSlot,
        getBlocks: () => blockSlots.map((slot) => ({slot}) as IBlockInput),
        getPayloadEnvelopes: () =>
          payloadSlots.length > 0
            ? new Map(payloadSlots.map((slot) => [slot, {hasPayloadEnvelope: () => true}]))
            : null,
      } as unknown as Batch;
    }

    function parentError(
      code: BlockErrorCode.PARENT_BLOCK_UNKNOWN | BlockErrorCode.PARENT_PAYLOAD_UNKNOWN,
      slot: Slot
    ): BlockError {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = slot;
      const type =
        code === BlockErrorCode.PARENT_PAYLOAD_UNKNOWN
          ? {code, parentRoot: "0x00", parentBlockHash: "0x00"}
          : {code, parentRoot: "0x00"};
      return new BlockError(signedBlock, type);
    }

    const startSlot = 2 * SLOTS_PER_EPOCH;
    const prevStartSlot = startSlot - SLOTS_PER_EPOCH;
    const batch = fakeBatch(startSlot);

    it("non-parent BlockError => ThisBatch", () => {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = startSlot;
      const err = new BlockError(signedBlock, {code: BlockErrorCode.NON_LINEAR_SLOTS});
      expect(classifyProcessingFault(err, batch, undefined)).toBe(ProcessingFaultKind.ThisBatch);
    });

    it("non-BlockError => ThisBatch", () => {
      expect(classifyProcessingFault(new Error("boom"), batch, undefined)).toBe(ProcessingFaultKind.ThisBatch);
    });

    it("internal-linkage codes => ThisBatch, never escalate", () => {
      const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
      signedBlock.message.slot = startSlot + 1;
      const err = new BlockError(signedBlock, {
        code: BlockErrorCode.NON_LINEAR_PAYLOAD_ROOTS,
        parentBlockHash: "0x00",
        expectedBlockHash: "0x11",
      });
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [startSlot - 3]))).toBe(
        ProcessingFaultKind.ThisBatch
      );
    });

    it("PARENT_BLOCK_UNKNOWN at startSlot with a previous batch => PreviousBatch", () => {
      const err = parentError(BlockErrorCode.PARENT_BLOCK_UNKNOWN, startSlot);
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [startSlot - 1]))).toBe(
        ProcessingFaultKind.PreviousBatch
      );
    });

    it("PARENT_BLOCK_UNKNOWN at startSlot with no previous batch => ThisBatch", () => {
      const err = parentError(BlockErrorCode.PARENT_BLOCK_UNKNOWN, startSlot);
      expect(classifyProcessingFault(err, batch, undefined)).toBe(ProcessingFaultKind.ThisBatch);
    });

    it("PARENT_PAYLOAD_UNKNOWN at startSlot with a previous batch => PreviousBatch", () => {
      const err = parentError(BlockErrorCode.PARENT_PAYLOAD_UNKNOWN, startSlot);
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [], [startSlot - 1]))).toBe(
        ProcessingFaultKind.PreviousBatch
      );
    });

    it("PARENT_PAYLOAD_UNKNOWN at startSlot with no previous batch => ThisBatch", () => {
      const err = parentError(BlockErrorCode.PARENT_PAYLOAD_UNKNOWN, startSlot);
      expect(classifyProcessingFault(err, batch, undefined)).toBe(ProcessingFaultKind.ThisBatch);
    });

    it("PARENT_BLOCK_UNKNOWN after startSlot, prev batch delivered tail block => ThisBatch", () => {
      const err = parentError(BlockErrorCode.PARENT_BLOCK_UNKNOWN, startSlot + 1);
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [startSlot - 1]))).toBe(
        ProcessingFaultKind.ThisBatch
      );
    });

    it("PARENT_BLOCK_UNKNOWN after startSlot, prev batch missing tail block => Ambiguous", () => {
      const err = parentError(BlockErrorCode.PARENT_BLOCK_UNKNOWN, startSlot + 1);
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [startSlot - 3]))).toBe(
        ProcessingFaultKind.Ambiguous
      );
    });

    it("PARENT_BLOCK_UNKNOWN after startSlot, prevBatch undefined => Ambiguous", () => {
      const err = parentError(BlockErrorCode.PARENT_BLOCK_UNKNOWN, startSlot + 1);
      expect(classifyProcessingFault(err, batch, undefined)).toBe(ProcessingFaultKind.Ambiguous);
    });

    it("PARENT_PAYLOAD_UNKNOWN after startSlot keys off prev batch tail payload", () => {
      const err = parentError(BlockErrorCode.PARENT_PAYLOAD_UNKNOWN, startSlot + 1);
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [], [startSlot - 1]))).toBe(
        ProcessingFaultKind.ThisBatch
      );
      expect(classifyProcessingFault(err, batch, fakeBatch(prevStartSlot, [], []))).toBe(ProcessingFaultKind.Ambiguous);
    });
  });

  function createBatch(status: BatchStatus, startEpoch = 0): Batch {
    const batch = new Batch(
      startEpoch,
      config,
      clock,
      new CustodyConfig({config, nodeId: Buffer.alloc(32)}),
      false,
      undefined,
      Number.MAX_SAFE_INTEGER
    );

    if (status === BatchStatus.AwaitingDownload) return batch;

    batch.startDownloading(peerSyncMeta);
    if (status === BatchStatus.Downloading) return batch;

    batch.downloadingSuccess(peer, [], null);
    if (status === BatchStatus.AwaitingProcessing) return batch;

    batch.startProcessing();
    if (status === BatchStatus.Processing) return batch;

    batch.processingSuccess();
    if (status === BatchStatus.AwaitingValidation) return batch;
    throw Error(`Unknown status: ${status}`);
  }
});
