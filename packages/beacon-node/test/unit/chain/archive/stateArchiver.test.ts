import {expect} from "chai";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {computeStateSlotsToDelete} from "../../../../src/chain/archiver/archiveStates.js";

describe("state archiver task", () => {
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
        expect(computeStateSlotsToDelete(storedStateSlots, persistEveryEpochs)).to.deep.equal(stateSlotsToDelete);
      });
    }
  });
});
