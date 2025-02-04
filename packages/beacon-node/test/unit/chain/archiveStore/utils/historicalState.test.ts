import {Logger} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {when} from "vitest-when";
import {DifferentialLayers} from "../../../../../src/chain/archiveStore/utils/differentialLayers.js";
import {codec, getDiffState, getLastStoredState} from "../../../../../src/chain/archiveStore/utils/historicalState.js";
import {IBeaconDb} from "../../../../../src/db/interface.js";
import {getMockedLogger} from "../../../../mocks/loggerMock.js";
import {getMockedBeaconDb} from "../../../../mocks/mockedBeaconDb.js";

describe("historicalState", () => {
  let db: IBeaconDb;
  let logger: Logger;
  let diffLayers: DifferentialLayers;

  beforeEach(async () => {
    db = getMockedBeaconDb();
    logger = getMockedLogger();
    diffLayers = new DifferentialLayers();

    vi.spyOn(codec, "apply");
    vi.spyOn(codec, "compute");

    await codec.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getLastStoredState", () => {
    let currentSlot: number;
    let snapshotSlot: number;
    let snapshotState: Uint8Array;
    let diffSlot: number;
    let diffState: Uint8Array;

    beforeEach(async () => {
      await codec.init();
      currentSlot = SLOTS_PER_EPOCH * 1000 + 3;
      snapshotSlot = diffLayers.getArchiveLayers(currentSlot)[0];
      diffSlot = diffLayers.getArchiveLayers(currentSlot)[1];

      snapshotState = Uint8Array.from(Buffer.from("Snapshot", "utf8"));
      diffState = Uint8Array.from(Buffer.from("Snapshot + Diff", "utf8"));

      when(db.stateSnapshotArchive.getBinary).calledWith(snapshotSlot).thenResolve(snapshotState);
      when(db.stateDiffArchive.getBinary).calledWith(diffSlot).thenResolve(codec.compute(snapshotState, diffState));
    });

    describe("should fetch the correct state for node initialized with checkpoint", () => {
      /**
       * | CP |    |    |    |    |    |    |    |    |    |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint and snapshot slot are same and no diff state", async () => {
        const checkpointSlot = snapshotSlot;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(null);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });

      /**
       * |    | CP |    |    |    |    |    |    |    |    |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint is higher than snapshot slot and no diff state", async () => {
        const checkpointSlot = snapshotSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(null);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });

      /**
       * |    |    | CP |    |    |    |    |    |    |    |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint is at diff slot", async () => {
        const checkpointSlot = diffSlot;
        const checkpointState = Uint8Array.from(Buffer.from("Snapshot + Checkpoint", "utf8"));

        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(diffSlot);
        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });

      /**
       * |    |    |    | CP |    |    |    |    |    |    |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint is higher than diff slot", async () => {
        const checkpointSlot = diffSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(diffSlot);

        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });

      /**
       * |    |    |    |    |    |    |    | CP |    |    |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint is arbitrary with higher snapshot state", async () => {
        const secondSnapshotSlot = snapshotSlot * 2;
        const secondSnapshotState = Uint8Array.from(Buffer.from("Second Snapshot", "utf8"));
        const checkpointSlot = secondSnapshotSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(diffSlot);

        when(db.stateSnapshotArchive.getBinary).calledWith(secondSnapshotSlot).thenResolve(secondSnapshotState);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });

      /**
       * |    |    |    |    |    |    |    |    |    | CP |    |    |
       * --------------------------------------------------------------
       * |    |    |    |    | D2 |    |    |    |    |    | D2 |    |
       * |    |    | D1 |    |    |    |    |    | D1 |    |    |    |
       * | SS |    |    |    |    |    | SS |    |    |    |    |    |
       */
      it("when checkpoint is arbitrary with higher diff state", async () => {
        const secondSnapshotSlot = snapshotSlot * 2;
        const secondSnapshotState = Uint8Array.from(Buffer.from("Second Snapshot", "utf8"));

        const secondDiffSlot = diffSlot * 2;
        const secondDiffState = Uint8Array.from(Buffer.from("Second Snapshot + Diff", "utf8"));

        const checkpointSlot = secondDiffSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(secondDiffSlot);

        when(db.stateSnapshotArchive.getBinary).calledWith(secondSnapshotSlot).thenResolve(secondSnapshotState);
        when(db.stateDiffArchive.getBinary).calledWith(secondDiffSlot).thenResolve(secondDiffState);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });
    });
  });

  describe("getDiffState", () => {
    it("should return empty state when db is empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      await expect(getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec})).resolves.toEqual({
        diffStateBytes: null,
        diffSlots: [0],
      });
    });

    it("should not apply any diff when db is empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(codec.compute).not.toBeCalled();
    });

    it("should return empty state when snapshot state is missing", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(null);

      await expect(getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec})).resolves.toEqual({
        diffStateBytes: null,
        diffSlots: [0, 10, 20, 30, 40],
      });
    });

    it("should fallback to last snapshot if given snapshot is missing", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(db.stateSnapshotArchive.lastKey).toBeCalledTimes(1);
    });

    it("should not fallback to last snapshot if given snapshot is available", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      when(db.stateDiffArchive.getBinary).calledWith(10).thenResolve(null);
      when(db.stateDiffArchive.getBinary).calledWith(20).thenResolve(null);
      when(db.stateDiffArchive.getBinary).calledWith(30).thenResolve(null);
      when(db.stateDiffArchive.getBinary).calledWith(40).thenResolve(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(db.stateSnapshotArchive.lastKey).not.toBeCalled();
    });

    it("should load all diffs when skipSlotDiff=false", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.stateDiffArchive.getBinary).mockResolvedValue(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(db.stateDiffArchive.getBinary).toHaveBeenCalledTimes(4);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(3, 30);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(4, 40);
    });

    it("should skip last diffs when skipSlotDiff=true and diff layer last slot is same", async () => {
      const slot = 40;
      const skipSlotDiff = true;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.stateDiffArchive.getBinary).mockResolvedValue(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(db.stateDiffArchive.getBinary).toHaveBeenCalledTimes(3);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(3, 30);
    });

    it("should not skip last diffs when skipSlotDiff=true but diff layer last slot is not the same", async () => {
      const slot = 38;
      const skipSlotDiff = true;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.stateDiffArchive.getBinary).mockResolvedValue(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(db.stateDiffArchive.getBinary).toHaveBeenCalledTimes(4);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(3, 30);
      expect(db.stateDiffArchive.getBinary).toHaveBeenNthCalledWith(4, 40);
    });

    it("should not apply any diff if empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.stateDiffArchive.getBinary).mockResolvedValue(null);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(codec.apply).not.toBeCalled();
    });

    it("should apply all diffs", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("init", "utf8");
      const state1 = Uint8Array.from(Buffer.from("init+1", "utf8"));
      const state2 = Uint8Array.from(Buffer.from("init+1+2", "utf8"));
      const state3 = Uint8Array.from(Buffer.from("init+1+2+3", "utf8"));
      const state4 = Uint8Array.from(Buffer.from("init+1+2+3+4", "utf8"));
      const diff1 = codec.compute(snapshotState, state1);
      const diff2 = codec.compute(state1, state2);
      const diff3 = codec.compute(state2, state3);
      const diff4 = codec.compute(state3, state4);

      vi.spyOn(diffLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
      when(db.stateDiffArchive.getBinary).calledWith(10).thenResolve(diff1);
      when(db.stateDiffArchive.getBinary).calledWith(20).thenResolve(diff2);
      when(db.stateDiffArchive.getBinary).calledWith(30).thenResolve(diff3);
      when(db.stateDiffArchive.getBinary).calledWith(40).thenResolve(diff4);

      await getDiffState({slot, skipSlotDiff}, {db, logger, diffLayers, codec});

      expect(codec.apply).toBeCalledTimes(4);
      expect(codec.apply).toHaveBeenNthCalledWith(1, snapshotState, diff1);
      expect(codec.apply).toHaveBeenNthCalledWith(2, state1, diff2);
      expect(codec.apply).toHaveBeenNthCalledWith(3, state2, diff3);
      expect(codec.apply).toHaveBeenNthCalledWith(4, state3, diff4);
      expect(codec.apply).toHaveNthReturnedWith(1, state1);
      expect(codec.apply).toHaveNthReturnedWith(2, state2);
      expect(codec.apply).toHaveNthReturnedWith(3, state3);
      expect(codec.apply).toHaveNthReturnedWith(4, state4);
    });
  });
});
