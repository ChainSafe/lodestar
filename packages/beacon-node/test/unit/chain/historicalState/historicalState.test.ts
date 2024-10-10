import {describe, it, beforeEach, vi, expect} from "vitest";
import {when} from "vitest-when";
import {Logger} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getLastStoredState, codec} from "../../../../src/chain/historicalState/historicalState.js";
import {DiffLayers} from "../../../../src/chain/historicalState/diffLayers.js";
import {getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {IBeaconDb} from "../../../../src/db/interface.js";

describe("historicalState", () => {
  let db: IBeaconDb;
  let logger: Logger;
  let diffLayers: DiffLayers;

  beforeEach(() => {
    db = getMockedBeaconDb();
    logger = getMockedLogger();
    diffLayers = new DiffLayers();
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
});
