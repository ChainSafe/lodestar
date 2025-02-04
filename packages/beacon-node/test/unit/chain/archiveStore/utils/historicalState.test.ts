import {Logger} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {when} from "vitest-when";
import {DifferentialStateOperation} from "../../../../../src/chain/archiveStore/interface.js";
import {DifferentialLayers} from "../../../../../src/chain/archiveStore/utils/differentialLayers.js";
import {codec} from "../../../../../src/chain/archiveStore/utils/differentialStateArchive.js";
import {getLastStoredState} from "../../../../../src/chain/archiveStore/utils/historicalState.js";
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getLastStoredState", () => {
    let operation: DifferentialStateOperation;
    let currentSlot: number;
    let snapshotState: Uint8Array;
    let diffState: Uint8Array;

    beforeEach(async () => {
      currentSlot = SLOTS_PER_EPOCH * 1000 + 3;
      operation = diffLayers.getOperation(currentSlot);

      snapshotState = Uint8Array.from(Buffer.from("Snapshot", "utf8"));
      diffState = Uint8Array.from(Buffer.from("Snapshot + Diff", "utf8"));

      when(db.stateSnapshotArchive.getBinary).calledWith(operation.snapshotSlot).thenResolve(snapshotState);
      when(db.stateDiffArchive.getBinary)
        .calledWith(operation.diffSlots[0])
        .thenResolve(codec.compute(snapshotState, diffState));
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
        const checkpointSlot = operation.snapshotSlot;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(null);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
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
        const checkpointSlot = operation.snapshotSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(null);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
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
        const checkpointSlot = operation.diffSlots[0];
        const checkpointState = Uint8Array.from(Buffer.from("Snapshot + Checkpoint", "utf8"));

        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(operation.diffSlots[0]);
        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
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
        const checkpointSlot = operation.diffSlots[0] + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(operation.diffSlots[0]);

        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
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
        const secondSnapshotSlot = operation.snapshotSlot * 2;
        const secondSnapshotState = Uint8Array.from(Buffer.from("Second Snapshot", "utf8"));
        const checkpointSlot = secondSnapshotSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(operation.diffSlots[0]);

        when(db.stateSnapshotArchive.getBinary).calledWith(secondSnapshotSlot).thenResolve(secondSnapshotState);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
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
        const secondSnapshotSlot = operation.snapshotSlot * 2;
        const secondSnapshotState = Uint8Array.from(Buffer.from("Second Snapshot", "utf8"));

        const secondDiffSlot = operation.diffSlots[0] * 2;
        const secondDiffState = Uint8Array.from(Buffer.from("Second Snapshot + Diff", "utf8"));

        const checkpointSlot = secondDiffSlot + 1;
        const checkpointState = Uint8Array.from(Buffer.from("Checkpoint", "utf8"));

        vi.mocked(db.stateSnapshotArchive.lastKey).mockResolvedValue(checkpointSlot);
        vi.mocked(db.stateDiffArchive.lastKey).mockResolvedValue(secondDiffSlot);

        when(db.stateSnapshotArchive.getBinary).calledWith(secondSnapshotSlot).thenResolve(secondSnapshotState);
        when(db.stateDiffArchive.getBinary).calledWith(secondDiffSlot).thenResolve(secondDiffState);
        when(db.stateSnapshotArchive.getBinary).calledWith(checkpointSlot).thenResolve(checkpointState);

        await expect(getLastStoredState({db, logger, diffLayers, metrics: null})).resolves.toEqual({
          stateBytes: checkpointState,
          slot: checkpointSlot,
        });
      });
    });
  });
});
