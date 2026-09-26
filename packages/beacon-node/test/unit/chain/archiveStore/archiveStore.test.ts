import {describe, expect, it, vi} from "vitest";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {ArchiveMode, ArchiveStore} from "../../../../src/chain/archiveStore/index.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {nextEventLoop} from "../../../../src/util/eventLoop.js";

describe("chain / archive / ArchiveStore", () => {
  it("does not throw through the finalized event when queueing fails synchronously", async () => {
    const controller = new AbortController();
    const logger = {
      error: vi.fn(),
    };
    const emitter = new ChainEventEmitter();
    const archiveStore = new ArchiveStore(
      {
        chain: {
          bufferPool: {},
          emitter,
          regen: {},
        },
        db: {},
        logger,
        metrics: null,
      } as never,
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)}},
        dbName: "test",
        dataColumnDir: "data_columns",
        isCheckpointState: false,
      },
      controller.signal
    );
    const finalized: CheckpointWithHex = {epoch: 1, root: new Uint8Array(32), rootHex: "0x00"};

    (archiveStore as unknown as {jobQueue: {push(finalized: CheckpointWithHex): Promise<void>}}).jobQueue = {
      push: vi.fn(() => {
        throw new Error("queueing failed");
      }),
    };

    expect(() => {
      emitter.emit(ChainEvent.forkChoiceFinalized, finalized);
    }).not.toThrow();
    await nextEventLoop();

    expect(logger.error).toHaveBeenCalledWith(
      "Error queuing finalized checkpoint",
      {epoch: finalized.epoch, rootHex: finalized.rootHex},
      expect.any(Error)
    );
  });

  it("init sets earliestAvailableSlot from the earliest retained block", async () => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    const chain = {bufferPool: {}, emitter, regen: {}, earliestAvailableSlot: 313312};
    const firstKey = vi.fn().mockResolvedValue(246560);
    const archiveStore = new ArchiveStore(
      {
        chain,
        db: {blockArchive: {firstKey}},
        logger: {info: vi.fn(), debug: vi.fn(), verbose: vi.fn()},
        metrics: null,
      } as never,
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)}},
        dbName: "test",
        dataColumnDir: "data_columns",
        pruneHistory: false,
        serveHistoricalState: false,
        isCheckpointState: false,
      } as never,
      controller.signal
    );

    await archiveStore.init();

    expect(firstKey).toHaveBeenCalledTimes(1);
    // Lowered from the anchor (313312) to the earliest block still retained in the archive
    expect(chain.earliestAvailableSlot).toBe(246560);
  });

  it("init keeps earliestAvailableSlot at the anchor when the archive is empty", async () => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    const chain = {bufferPool: {}, emitter, regen: {}, earliestAvailableSlot: 313312};
    const archiveStore = new ArchiveStore(
      {
        chain,
        db: {blockArchive: {firstKey: vi.fn().mockResolvedValue(null)}},
        logger: {info: vi.fn(), debug: vi.fn(), verbose: vi.fn()},
        metrics: null,
      } as never,
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)}},
        dbName: "test",
        dataColumnDir: "data_columns",
        pruneHistory: false,
        serveHistoricalState: false,
        isCheckpointState: false,
      } as never,
      controller.signal
    );

    await archiveStore.init();

    expect(chain.earliestAvailableSlot).toBe(313312);
  });

  it("init keeps earliestAvailableSlot at the anchor when checkpoint-synced despite older retained blocks", async () => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    // Node checkpoint-synced this startup from anchor 313312, but the DB still holds older, non-contiguous
    // blocks (firstKey 246560). Until backfill exists we cannot serve the gap, so EAS must stay at the anchor.
    const chain = {bufferPool: {}, emitter, regen: {}, earliestAvailableSlot: 313312};
    const firstKey = vi.fn().mockResolvedValue(246560);
    const archiveStore = new ArchiveStore(
      {
        chain,
        db: {blockArchive: {firstKey}},
        logger: {info: vi.fn(), debug: vi.fn(), verbose: vi.fn()},
        metrics: null,
      } as never,
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: {epoch: 0, root: new Uint8Array(32)}},
        dbName: "test",
        dataColumnDir: "data_columns",
        pruneHistory: false,
        serveHistoricalState: false,
        isCheckpointState: true,
      } as never,
      controller.signal
    );

    await archiveStore.init();

    expect(firstKey).not.toHaveBeenCalled();
    expect(chain.earliestAvailableSlot).toBe(313312);
  });
});
