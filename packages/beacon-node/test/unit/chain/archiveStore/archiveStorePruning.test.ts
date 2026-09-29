import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {LogLevel} from "@lodestar/utils";
import {ArchiveMode, ArchiveStore} from "../../../../src/chain/archiveStore/index.js";
import {FrequencyStateArchiveStrategy} from "../../../../src/chain/archiveStore/strategies/frequencyStateArchiveStrategy.js";
import * as archiveBlocksModule from "../../../../src/chain/archiveStore/utils/archiveBlocks.js";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../../src/constants/index.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {startTmpBeaconDb} from "../../../utils/db.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("chain / archiveStore / state pruning progress", () => {
  const previousSlot = computeStartSlotAtEpoch(90);
  const nextSlot = computeStartSlotAtEpoch(100);
  let db: BeaconDb;
  let chain: MockedBeaconChain;
  let logger: ReturnType<typeof testLogger>;
  let controller: AbortController;
  let store: ArchiveStore;

  beforeEach(async () => {
    db = await startTmpBeaconDb(config);
    chain = getMockedBeaconChain();
    chain.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 0}));
    chain.forkChoice.prune = vi.fn().mockReturnValue([]);
    logger = testLogger();
    controller = new AbortController();
    vi.spyOn(archiveBlocksModule, "archiveBlocks").mockResolvedValue();
    vi.spyOn(FrequencyStateArchiveStrategy.prototype, "maybeArchiveState").mockResolvedValue();
    store = new ArchiveStore(
      {chain, db, logger, metrics: null},
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1024,
        anchorState: {finalizedCheckpoint: {epoch: 98, root: ZERO_HASH}},
        dbName: "test",
        dataColumnDir: "data_columns",
        pruneHistory: true,
      },
      controller.signal
    );
    await db.stateArchive.putBinary(0, new Uint8Array([0]));
    await db.stateArchive.putBinary(previousSlot, new Uint8Array([1]));
    await store.init();
  });

  afterEach(async () => {
    controller.abort();
    await store.close();
    vi.restoreAllMocks();
    await db.close();
  });

  it("reuses the startup cutoff and advances it after pruning a new state range", async () => {
    const keys = vi.spyOn(db.stateArchive, "keys");

    chain.emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 99, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    await vi.waitFor(() => expect(chain.forkChoice.prune).toHaveBeenCalledTimes(1));
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([]);

    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    chain.emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 102, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    await vi.waitFor(() => expect(chain.forkChoice.prune).toHaveBeenCalledTimes(2));
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);

    chain.emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 103, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    await vi.waitFor(() => expect(chain.forkChoice.prune).toHaveBeenCalledTimes(3));
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([[{gte: previousSlot, lt: nextSlot}]]);
  });

  it("retries the same state range when deletion fails", async () => {
    await db.stateArchive.putBinary(nextSlot, new Uint8Array([2]));
    const keys = vi.spyOn(db.stateArchive, "keys");
    const error = new Error("State deletion failed");
    vi.spyOn(db.stateArchive, "batchDelete").mockRejectedValueOnce(error);
    const logError = vi.spyOn(logger, LogLevel.error).mockImplementation(() => {});

    chain.emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 102, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    await vi.waitFor(() =>
      expect(logError).toHaveBeenCalledWith("Error processing finalized checkpoint", {epoch: 102}, error)
    );
    expect(await db.stateArchive.keys()).toEqual([previousSlot, nextSlot]);

    chain.emitter.emit(ChainEvent.forkChoiceFinalized, {epoch: 102, root: ZERO_HASH, rootHex: ZERO_HASH_HEX});
    await vi.waitFor(() => expect(chain.forkChoice.prune).toHaveBeenCalledTimes(1));
    expect(keys.mock.calls.filter(([opts]) => opts?.gte !== undefined)).toEqual([
      [{gte: previousSlot, lt: nextSlot}],
      [{gte: previousSlot, lt: nextSlot}],
    ]);
    expect(await db.stateArchive.keys()).toEqual([nextSlot]);
  });
});
