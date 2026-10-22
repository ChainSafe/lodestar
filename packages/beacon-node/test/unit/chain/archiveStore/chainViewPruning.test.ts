import {describe, expect, it, vi} from "vitest";
import {PayloadStatus} from "@lodestar/fork-choice";
import {defer, toRootHex} from "@lodestar/utils";
import {ArchiveMode, ArchiveStore} from "../../../../src/chain/archiveStore/index.js";
import {archiveBlocks} from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {FinalizedCheckpointSnapshot} from "../../../../src/chain/beaconEngine/interface.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {nextEventLoop} from "../../../../src/util/eventLoop.js";

vi.mock("../../../../src/chain/archiveStore/utils/archiveBlocks.js", () => ({archiveBlocks: vi.fn()}));

describe("ArchiveStore ChainView pruning", () => {
  it("keeps each queued checkpoint paired with its pulled block snapshot", async () => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    const firstArchive = defer<void>();
    const completeFinalization = vi.fn().mockResolvedValue(0);
    const pruneChainView = vi.fn();
    const logger = {verbose: vi.fn(), error: vi.fn()};
    const snapshots = [1, 2].map((epoch): FinalizedCheckpointSnapshot & {rootHex: string} => {
      const root = new Uint8Array(32).fill(epoch);
      const rootHex = toRootHex(root);
      return {
        epoch,
        root,
        rootHex,
        slot: epoch * 32,
        stateRoot: new Uint8Array(32),
        executionOptimistic: false,
        blockSnapshot: {
          canonical: [{slot: epoch * 32, blockRoot: rootHex, payloadStatus: PayloadStatus.FULL}],
          nonCanonical: [],
        },
      };
    });
    vi.mocked(archiveBlocks).mockReset().mockReturnValueOnce(firstArchive.promise).mockResolvedValue(undefined);
    new ArchiveStore(
      {
        chain: {
          emitter,
          clock: {currentEpoch: 2},
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
        anchorState: {finalizedCheckpoint: snapshots[0]},
        dbName: "test",
        dataColumnDir: "data_columns",
      },
      controller.signal
    );
    try {
      emitter.emit(ChainEvent.forkChoiceFinalized, snapshots[0]);
      await vi.waitFor(() => expect(archiveBlocks).toHaveBeenCalledOnce());
      emitter.emit(ChainEvent.forkChoiceFinalized, snapshots[1]);
      await nextEventLoop();
      expect(archiveBlocks).toHaveBeenCalledOnce();
      expect(pruneChainView).not.toHaveBeenCalled();
      firstArchive.resolve();
      await vi.waitFor(() => expect(pruneChainView).toHaveBeenCalledTimes(2));
      for (const [index, snapshot] of snapshots.entries()) {
        expect(vi.mocked(archiveBlocks).mock.calls[index][3], `snapshot for epoch ${snapshot.epoch}`).toBe(
          snapshot.blockSnapshot
        );
        expect(completeFinalization.mock.calls[index], `checkpoint for epoch ${snapshot.epoch}`).toEqual([
          {epoch: snapshot.epoch, root: snapshot.root, rootHex: snapshot.rootHex},
        ]);
      }
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      firstArchive.resolve();
      controller.abort();
    }
  });

  it.each(["none", "archive", "finalization"])("prunes only after successful archival (failure: %s)", async (fail) => {
    const controller = new AbortController();
    const emitter = new ChainEventEmitter();
    const finalized = {
      epoch: 1,
      root: new Uint8Array(32),
      rootHex: "0x00",
      slot: 32,
      stateRoot: new Uint8Array(32),
      executionOptimistic: false,
      blockSnapshot: {canonical: [], nonCanonical: []},
    };
    const checkpoint = {epoch: finalized.epoch, root: finalized.root, rootHex: finalized.rootHex};
    const completion = defer<number>();
    const archival = defer<void>();
    const completeFinalization = vi.fn(() => completion.promise);
    const pruneChainView = vi.fn();
    const logger = {verbose: vi.fn(), error: vi.fn()};
    vi.mocked(archiveBlocks).mockReset().mockReturnValue(archival.promise);
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
      await vi.waitFor(() => expect(archiveBlocks).toHaveBeenCalledOnce());
      expect(vi.mocked(archiveBlocks).mock.calls[0][3]).toBe(finalized.blockSnapshot);
      expect(completeFinalization).not.toHaveBeenCalled();
      expect(pruneChainView).not.toHaveBeenCalled();
      if (fail === "archive") {
        archival.reject(new Error("envelope migration failed"));
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
        expect(completeFinalization).not.toHaveBeenCalled();
        expect(pruneChainView).not.toHaveBeenCalled();
        return;
      }
      archival.resolve();
      await vi.waitFor(() => expect(completeFinalization).toHaveBeenCalledWith(checkpoint));
      expect(pruneChainView).not.toHaveBeenCalled();
      if (fail === "finalization") {
        completion.reject(new Error("archive failed"));
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
        expect(pruneChainView).not.toHaveBeenCalled();
      } else {
        completion.resolve(0);
        await vi.waitFor(() => expect(pruneChainView).toHaveBeenCalledExactlyOnceWith(checkpoint));
      }
    } finally {
      controller.abort();
    }
  });
});
