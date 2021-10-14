import {expect} from "chai";
import {computeEpochsToDelete} from "../../../../src/chain/archiver/archiveStates";

describe("state archiver task", () => {
  describe("computeEpochsToDelete", () => {
    const testCases: {
      id: string;
      storedEpochs: number[];
      persistEveryEpochs?: number;
      toDelete: number[];
    }[] = [
      {
        id: "Empty",
        storedEpochs: [],
        toDelete: [],
      },
      {
        id: "Equally spaced, delete x%8 != 0",
        storedEpochs: [0, 2, 4, 6, 8, 10, 12, 14, 16],
        persistEveryEpochs: 8,
        toDelete: [2, 4, 6, 10, 12, 14],
      },
      {
        id: "Equally spaced with offset",
        storedEpochs: [0, 3, 5, 7, 9, 11, 13, 15, 17],
        persistEveryEpochs: 8,
        toDelete: [3, 5, 7, 11, 13, 15],
      },
      {
        id: "Edge case with offset that causes a very large gap between epochs",
        storedEpochs: [7, 8, 23, 24],
        persistEveryEpochs: 8,
        toDelete: [],
      },
    ];

    for (const {id, storedEpochs, persistEveryEpochs, toDelete} of testCases) {
      it(id, () => {
        expect(computeEpochsToDelete(storedEpochs, persistEveryEpochs ?? 1024)).to.deep.equal(toDelete);
      });
    }
  });
});
