import {mkdtemp, rm} from "node:fs/promises";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db/controller/level";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ArchiveMode, ArchiveStore} from "../../../../src/chain/archiveStore/index.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {BeaconDb} from "../../../../src/db/beacon.js";
import {nextEventLoop} from "../../../../src/util/eventLoop.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

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
});

describe("chain / archive / ArchiveStore persisted earliestAvailableSlot", () => {
  const config = createChainForkConfig({MIN_EPOCHS_FOR_BLOCK_REQUESTS: 10});
  const logger = testLogger();
  const anchorSlot = 313312;
  const retainedSlot = 246560;
  let testDir: string;
  let db: BeaconDb;
  let controller: AbortController;

  async function openDb(): Promise<BeaconDb> {
    const levelDb = await LevelDbController.create({name: path.join(testDir, "leveldb")}, {logger});
    const beaconDb = new BeaconDb(config, levelDb, {dataColumnDir: path.join(testDir, "data_columns"), logger});
    await beaconDb.init();
    return beaconDb;
  }

  function createArchiveStore(isCheckpointState: boolean, slot = anchorSlot, pruneHistory = false) {
    const chain = getMockedBeaconChain({config});
    chain.earliestAvailableSlot = slot;
    const archiveStore = new ArchiveStore(
      {chain, db, logger, metrics: null},
      {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
        anchorState: {finalizedCheckpoint: {epoch: Math.floor(slot / SLOTS_PER_EPOCH), root: new Uint8Array(32)}},
        dbName: path.join(testDir, "leveldb"),
        dataColumnDir: path.join(testDir, "data_columns"),
        pruneHistory,
        serveHistoricalState: false,
        isCheckpointState,
      },
      controller.signal
    );
    return {chain, archiveStore};
  }

  async function putBlock(slot: number): Promise<void> {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    await db.blockArchive.put(slot, block);
  }

  beforeEach(async () => {
    testDir = await mkdtemp(path.join(process.cwd(), ".tmp-eas-"));
    controller = new AbortController();
    db = await openDb();
  });

  afterEach(async () => {
    controller.abort();
    await db.close();
    await rm(testDir, {recursive: true, force: true});
    vi.restoreAllMocks();
  });

  it.each([0, retainedSlot])("bootstraps and persists the retained floor %i when no record exists", async (slot) => {
    await putBlock(slot);
    expect(await db.earliestAvailableSlot.get()).toBeNull();
    const firstKey = vi.spyOn(db.blockArchive, "firstKey");
    const {chain, archiveStore} = createArchiveStore(false);

    await archiveStore.init();

    expect(firstKey).toHaveBeenCalledOnce();
    expect(chain.earliestAvailableSlot).toBe(slot);
    expect(await db.earliestAvailableSlot.get()).toBe(slot);
  });

  it("persists the anchor when both the archive and the stored floor are empty", async () => {
    const {chain, archiveStore} = createArchiveStore(false);

    await archiveStore.init();

    expect(chain.earliestAvailableSlot).toBe(anchorSlot);
    expect(await db.earliestAvailableSlot.get()).toBe(anchorSlot);
  });

  it.each([retainedSlot, anchorSlot + 32])(
    "preserves the checkpoint floor across a plain DB restart, replacing stale floor %i",
    async (staleSlot) => {
      await putBlock(retainedSlot);
      await putBlock(anchorSlot);
      await db.earliestAvailableSlot.put(staleSlot);
      const firstKey = vi.spyOn(db.blockArchive, "firstKey");
      const getFloor = vi.spyOn(db.earliestAvailableSlot, "get");
      const checkpoint = createArchiveStore(true);

      await checkpoint.archiveStore.init();

      expect(getFloor).not.toHaveBeenCalled();
      expect(firstKey).not.toHaveBeenCalled();
      expect(checkpoint.chain.earliestAvailableSlot).toBe(anchorSlot);
      expect(await db.earliestAvailableSlot.get()).toBe(anchorSlot);
      await checkpoint.archiveStore.close();
      await db.close();
      db = await openDb();
      expect(await db.blockArchive.firstKey()).toBe(retainedSlot);
      const restartedFirstKey = vi.spyOn(db.blockArchive, "firstKey");
      const restart = createArchiveStore(false, anchorSlot + 64);

      await restart.archiveStore.init();

      expect(restartedFirstKey).not.toHaveBeenCalled();
      expect(restart.chain.earliestAvailableSlot).toBe(anchorSlot);
      expect(await db.earliestAvailableSlot.get()).toBe(anchorSlot);
    }
  );

  it("restores a persisted genesis floor without consulting the archive", async () => {
    await db.earliestAvailableSlot.put(0);
    await putBlock(retainedSlot);
    const firstKey = vi.spyOn(db.blockArchive, "firstKey");
    const {chain, archiveStore} = createArchiveStore(false);

    await archiveStore.init();

    expect(firstKey).not.toHaveBeenCalled();
    expect(chain.earliestAvailableSlot).toBe(0);
  });

  it("raises and persists the restored floor when history is pruned during startup", async () => {
    const cutoffSlot = 20 * SLOTS_PER_EPOCH;
    await db.earliestAvailableSlot.put(0);
    await putBlock(0);
    await putBlock(cutoffSlot);
    const {chain, archiveStore} = createArchiveStore(false, 28 * SLOTS_PER_EPOCH, true);
    vi.spyOn(chain.clock, "currentEpoch", "get").mockReturnValue(30);

    await archiveStore.init();

    expect(await db.blockArchive.get(0)).toBeNull();
    expect(chain.earliestAvailableSlot).toBe(cutoffSlot);
    expect(await db.earliestAvailableSlot.get()).toBe(cutoffSlot);
  });

  it.each([0, 25 * SLOTS_PER_EPOCH])("persists the runtime prune floor starting at %i", async (initialFloor) => {
    const cutoffSlot = 20 * SLOTS_PER_EPOCH;
    const finalizedSlot = 28 * SLOTS_PER_EPOCH;
    const expectedFloor = Math.max(initialFloor, cutoffSlot);
    const {chain, archiveStore} = createArchiveStore(true, initialFloor, true);
    await archiveStore.init();
    await putBlock(0);
    await putBlock(cutoffSlot);
    await db.stateArchive.putBinary(finalizedSlot, new Uint8Array([1]));
    vi.spyOn(chain.clock, "currentEpoch", "get").mockReturnValue(30);
    vi.spyOn(chain.clock, "currentSlot", "get").mockReturnValue(30 * SLOTS_PER_EPOCH);
    chain.forkChoice.getHead.mockReturnValue(generateProtoBlock({slot: 30 * SLOTS_PER_EPOCH}));
    chain.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus.mockReturnValue({ancestors: [], nonAncestors: []});
    chain.forkChoice.prune = vi.fn().mockReturnValue([]);
    const finalized: CheckpointWithHex = {epoch: 28, root: new Uint8Array(32), rootHex: "0x00"};

    chain.emitter.emit(ChainEvent.forkChoiceFinalized, finalized);
    await vi.waitFor(() => expect(chain.forkChoice.prune).toHaveBeenCalledOnce());

    expect(await db.blockArchive.get(0)).toBeNull();
    expect(chain.earliestAvailableSlot).toBe(expectedFloor);
    expect(await db.earliestAvailableSlot.get()).toBe(expectedFloor);
    await archiveStore.close();
    await db.close();
    db = await openDb();
    const restart = createArchiveStore(false, finalizedSlot);
    await restart.archiveStore.init();
    expect(restart.chain.earliestAvailableSlot).toBe(expectedFloor);
  });
});
