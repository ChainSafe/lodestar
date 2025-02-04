import {Logger} from "@lodestar/logger";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {when} from "vitest-when";
import {DifferentialLayers} from "../../../../../src/chain/archiveStore/utils/differentialLayers.js";
import {
  codec,
  processDifferentialStateOperation,
} from "../../../../../src/chain/archiveStore/utils/differentialStateArchive.js";
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

  describe("processDifferentialStateOperation", () => {
    describe("process snapshot state", () => {
      it("should raise error when snapshot not available", async () => {
        await expect(
          processDifferentialStateOperation(
            {db, logger, diffLayers, metrics: null},
            {snapshotSlot: 0, diffSlots: [], blockReplay: undefined}
          )
        ).rejects.toThrow("Can not find snapshot state");
      });

      it("should return empty state when snapshot state is missing", async () => {
        const operation = {snapshotSlot: 0, diffSlots: [10, 20, 30, 40], blockReplay: undefined};

        vi.spyOn(diffLayers, "getOperation").mockReturnValue(operation);
        when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(null);

        await expect(
          processDifferentialStateOperation({db, logger, diffLayers, metrics: null}, operation)
        ).rejects.toThrow("Can not find snapshot state");
      });

      it("should fallback to last snapshot if given snapshot is missing", async () => {
        const operation = {snapshotSlot: 0, diffSlots: [10, 20, 30, 40], blockReplay: undefined};

        vi.spyOn(diffLayers, "getOperation").mockReturnValue(operation);
        when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(null);

        await expect(
          processDifferentialStateOperation({db, logger, diffLayers, metrics: null}, operation)
        ).rejects.toThrow("Can not find snapshot state");

        expect(db.stateSnapshotArchive.lastKey).toBeCalledTimes(1);
      });

      it("should not fallback to last snapshot if given snapshot is available", async () => {
        const snapshotState = Buffer.from("abcdec", "utf8");
        const operation = {snapshotSlot: 0, diffSlots: [10, 20, 30, 40], blockReplay: undefined};

        vi.spyOn(diffLayers, "getOperation").mockReturnValue(operation);
        when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
        when(db.stateDiffArchive.getBinary).calledWith(10).thenResolve(null);
        when(db.stateDiffArchive.getBinary).calledWith(20).thenResolve(null);
        when(db.stateDiffArchive.getBinary).calledWith(30).thenResolve(null);
        when(db.stateDiffArchive.getBinary).calledWith(40).thenResolve(null);

        await expect(
          processDifferentialStateOperation({db, logger, diffLayers, metrics: null}, operation)
        ).rejects.toThrow("Can not find any required diffs 10,20,30,40");

        expect(db.stateSnapshotArchive.lastKey).not.toBeCalled();
      });
    });

    describe("process diff states", () => {
      it("should not apply any diff if empty", async () => {
        const snapshotState = Buffer.from("abcdec", "utf8");
        const operation = {snapshotSlot: 0, diffSlots: [10, 20, 30, 40], blockReplay: undefined};

        vi.spyOn(diffLayers, "getOperation").mockReturnValue(operation);
        when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
        vi.mocked(db.stateDiffArchive.getBinary).mockResolvedValue(null);

        await expect(
          processDifferentialStateOperation({db, logger, diffLayers, metrics: null}, operation)
        ).rejects.toThrow("Can not find any required diffs 10,20,30,40");

        expect(codec.apply).not.toBeCalled();
      });

      it("should apply all diffs", async () => {
        const snapshotState = Buffer.from("init", "utf8");
        const operation = {snapshotSlot: 0, diffSlots: [10, 20, 30, 40], blockReplay: undefined};

        const state1 = Uint8Array.from(Buffer.from("init+1", "utf8"));
        const state2 = Uint8Array.from(Buffer.from("init+1+2", "utf8"));
        const state3 = Uint8Array.from(Buffer.from("init+1+2+3", "utf8"));
        const state4 = Uint8Array.from(Buffer.from("init+1+2+3+4", "utf8"));
        const diff1 = codec.compute(snapshotState, state1);
        const diff2 = codec.compute(state1, state2);
        const diff3 = codec.compute(state2, state3);
        const diff4 = codec.compute(state3, state4);

        vi.spyOn(diffLayers, "getOperation").mockReturnValue(operation);
        when(db.stateSnapshotArchive.getBinary).calledWith(0).thenResolve(snapshotState);
        when(db.stateDiffArchive.getBinary).calledWith(10).thenResolve(diff1);
        when(db.stateDiffArchive.getBinary).calledWith(20).thenResolve(diff2);
        when(db.stateDiffArchive.getBinary).calledWith(30).thenResolve(diff3);
        when(db.stateDiffArchive.getBinary).calledWith(40).thenResolve(diff4);

        await processDifferentialStateOperation({db, logger, diffLayers, metrics: null}, operation);

        expect(codec.apply).toHaveBeenCalledTimes(4);
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
});
