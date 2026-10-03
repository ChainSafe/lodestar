import {describe, expect, it, vi} from "vitest";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {defer} from "@lodestar/utils";
import {ArchiveMode, ArchiveStore} from "../../../../src/chain/archiveStore/index.js";
import {archiveBlocks} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";

vi.mock("../../../../src/chain/archiveStore/utils/archiveBlocks.js", () => ({archiveBlocks: vi.fn()}));

describe("ArchiveStore ChainView pruning", () => {
  it.each([false, true])("prunes only after successful archival (failure: %s)", async (fail) => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    const finalized: CheckpointWithHex = {epoch: 1, root: new Uint8Array(32), rootHex: "0x00"};
    const completion = defer<number>();
    const completeFinalization = vi.fn(() => completion.promise);
    const pruneChainView = vi.fn();
    const logger = {verbose: vi.fn(), error: vi.fn()};
    vi.mocked(archiveBlocks).mockResolvedValue(undefined);
    new ArchiveStore(
      {
        chain: {
          emitter,
          clock: {currentSlot: 32, currentEpoch: 1},
          getHead: () => ({slot: 32}),
          opts: {},
          beaconEngine: {completeFinalization},
          pruneChainView,
        },
        db: {},
        logger,
        metrics: null,
      } as unknown as ConstructorParameters<typeof ArchiveStore>[0],
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: finalized},
        dbName: "test",
        dataColumnDir: "data_columns",
      },
      controller.signal
    );
    try {
      emitter.emit(ChainEvent.forkChoiceFinalized, finalized);
      await vi.waitFor(() => expect(completeFinalization).toHaveBeenCalledWith(finalized));
      expect(pruneChainView).not.toHaveBeenCalled();
      if (fail) {
        completion.reject(new Error("archive failed"));
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
        expect(pruneChainView).not.toHaveBeenCalled();
      } else {
        completion.resolve(0);
        await vi.waitFor(() => expect(pruneChainView).toHaveBeenCalledExactlyOnceWith(finalized));
      }
    } finally {
      controller.abort();
    }
  });
});
