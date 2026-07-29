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
      {epoch: finalized.epoch},
      expect.any(Error)
    );
  });
});
