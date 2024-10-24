import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import {when} from "vitest-when";
import {Logger} from "@lodestar/logger";
import {IBeaconDb} from "../../../../../src/index.js";
import {getMockedBeaconDb} from "../../../../mocks/mockedBeaconDb.js";
import {getMockedLogger} from "../../../../mocks/loggerMock.js";
import {getDiffStateArchive} from "../../../../../src/chain/historicalState/utils/diff.js";
import {IStateDiffCodec} from "../../../../../src/chain/historicalState/types.js";
import {HierarchicalLayers} from "../../../../../src/chain/historicalState/utils/hierarchicalLayers.js";
import {XDelta3Codec} from "../../../../../src/chain/historicalState/utils/xdelta3.js";

describe("historicalState/util", () => {
  let db: IBeaconDb;
  let logger: Logger;
  let hierarchicalLayers: HierarchicalLayers;
  let codec: IStateDiffCodec;

  beforeEach(async () => {
    db = getMockedBeaconDb();
    logger = getMockedLogger();
    hierarchicalLayers = HierarchicalLayers.fromString();
    codec = new XDelta3Codec();

    vi.spyOn(codec, "apply");
    vi.spyOn(codec, "compute");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getDiffState", () => {
    it("should return empty state when db is empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      await expect(
        getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec})
      ).resolves.toEqual({
        diffStateBytes: null,
        diffSlots: [0],
      });
    });

    it("should not apply any diff when db is empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(codec.compute).not.toBeCalled();
    });

    it("should return empty state when snapshot state is missing", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(null);

      await expect(
        getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec})
      ).resolves.toEqual({
        diffStateBytes: null,
        diffSlots: [0, 10, 20, 30, 40],
      });
    });

    it("should fallback to last snapshot if given snapshot is missing", async () => {
      const slot = 0;
      const skipSlotDiff = false;

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(db.hierarchicalStateArchiveRepository.lastKey).toBeCalledTimes(1);
    });

    it("should not fallback to last snapshot if given snapshot is available", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(10).thenResolve(null);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(20).thenResolve(null);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(30).thenResolve(null);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(40).thenResolve(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(db.hierarchicalStateArchiveRepository.lastKey).not.toBeCalled();
    });

    it("should load all diffs when skipSlotDiff=false", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.hierarchicalStateArchiveRepository.getBinary).mockResolvedValue(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenCalledTimes(4);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(3, 30);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(4, 40);
    });

    it("should skip last diffs when skipSlotDiff=true and diff layer last slot is same", async () => {
      const slot = 40;
      const skipSlotDiff = true;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.hierarchicalStateArchiveRepository.getBinary).mockResolvedValue(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenCalledTimes(3);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(3, 30);
    });

    it("should not skip last diffs when skipSlotDiff=true but diff layer last slot is not the same", async () => {
      const slot = 38;
      const skipSlotDiff = true;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.hierarchicalStateArchiveRepository.getBinary).mockResolvedValue(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenCalledTimes(4);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(1, 10);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(2, 20);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(3, 30);
      expect(db.hierarchicalStateArchiveRepository.getBinary).toHaveBeenNthCalledWith(4, 40);
    });

    it("should not apply any diff if empty", async () => {
      const slot = 0;
      const skipSlotDiff = false;
      const snapshotState = Buffer.from("abcdec", "utf8");

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      vi.mocked(db.hierarchicalStateArchiveRepository.getBinary).mockResolvedValue(null);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

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

      vi.spyOn(hierarchicalLayers, "getArchiveLayers").mockReturnValue([0, 10, 20, 30, 40]);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(0).thenResolve(snapshotState);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(10).thenResolve(diff1);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(20).thenResolve(diff2);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(30).thenResolve(diff3);
      when(db.hierarchicalStateArchiveRepository.getBinary).calledWith(40).thenResolve(diff4);

      await getDiffStateArchive({slot, skipSlotDiff}, {db, logger, hierarchicalLayers: hierarchicalLayers, codec});

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
