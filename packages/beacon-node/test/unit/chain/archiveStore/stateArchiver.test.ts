import {describe, expect, it, vi} from "vitest";
import {PayloadStatus} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ArchiveMode} from "../../../../src/chain/archiveStore/interface.js";
import {
  FrequencyStateArchiveStrategy,
  computeStateSlotsToDelete,
} from "../../../../src/chain/archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {testLogger} from "../../../utils/logger.js";

describe("state archiver task", () => {
  describe("archiveState", () => {
    it("reloads the block-state variant for post-Gloas finalized checkpoints", async () => {
      const config = {getForkName: () => "gloas"};
      const regen = {getCheckpointStateOrBytes: vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))};
      const db = {stateArchive: {putBinary: vi.fn().mockResolvedValue(undefined)}};
      const strategy = new FrequencyStateArchiveStrategy(config, regen as any, db as any, testLogger(), {
        archiveMode: ArchiveMode.Frequency,
        archiveStateEpochFrequency: 1,
      });
      const checkpoint = {
        epoch: 2,
        root: Buffer.alloc(32, 0x22),
        rootHex: "0x" + Buffer.alloc(32, 0x22).toString("hex"),
        payloadStatus: PayloadStatus.FULL,
      };

      await strategy.archiveState(checkpoint);

      expect(regen.getCheckpointStateOrBytes).toHaveBeenCalledWith({
        epoch: checkpoint.epoch,
        rootHex: checkpoint.rootHex,
        payloadPresent: false,
      });
    });
  });

  describe("computeStateSlotsToDelete", () => {
    const testCases: {
      id: string;
      storedEpochs: number[];
      persistEveryEpochs: number;
      epochsToDelete: number[];
    }[] = [
      {
        id: "Empty",
        storedEpochs: [],
        persistEveryEpochs: 8,
        epochsToDelete: [],
      },
      {
        id: "Equally spaced, delete x%8 != 0",
        storedEpochs: [0, 2, 4, 6, 8, 10, 12, 14, 16],
        persistEveryEpochs: 8,
        epochsToDelete: [2, 4, 6, 10, 12, 14],
      },
      {
        id: "Equally spaced with offset",
        storedEpochs: [0, 3, 5, 7, 9, 11, 13, 15, 17],
        persistEveryEpochs: 8,
        epochsToDelete: [3, 5, 7, 11, 13, 15],
      },
      {
        id: "Edge case with offset that causes a very large gap between epochs",
        storedEpochs: [7, 8, 23, 24],
        persistEveryEpochs: 8,
        epochsToDelete: [],
      },
    ];

    for (const {id, storedEpochs, persistEveryEpochs, epochsToDelete} of testCases) {
      it(id, () => {
        const storedStateSlots = storedEpochs.map((epoch) => computeStartSlotAtEpoch(epoch));
        const stateSlotsToDelete = epochsToDelete.map((epoch) => computeStartSlotAtEpoch(epoch));
        expect(computeStateSlotsToDelete(storedStateSlots, persistEveryEpochs)).toEqual(stateSlotsToDelete);
      });
    }
  });
});
