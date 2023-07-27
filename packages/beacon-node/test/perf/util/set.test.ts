import {itBench} from "@dapplion/benchmark";
import {OrderedSet} from "../../../src/util/set.js";

enum DeleteType {
  First = "first",
  Last = "last",
  Middle = "middle",
}

/**
 * Deleting from first and last is < 2x compared to a regular Set
 * Deleting from the middle is >3x depending on the set size but we don't use it as of Jul 2023.
 */
describe("OrderedSet vs Set", () => {
  const lengths = [64, 128, 256];

  for (const length of lengths) {
    const itemsToDeleteByFirst = Array.from({length}, (_, i) => i);
    const itemsToDeleteByLast = Array.from({length}, (_, i) => length - i - 1);
    const itemsToDeleteSeedArray = Array.from({length}, (_, i) => i);
    const itemsToDeleteByMiddle = [];
    for (let i = 0; i < length; i++) {
      const toDelete = Math.floor(itemsToDeleteSeedArray.length / 2);
      itemsToDeleteByMiddle.push(itemsToDeleteSeedArray[toDelete]);
      itemsToDeleteSeedArray.splice(toDelete, 1);
    }
    const itemsToDelete = {
      [DeleteType.First]: itemsToDeleteByFirst,
      [DeleteType.Last]: itemsToDeleteByLast,
      [DeleteType.Middle]: itemsToDeleteByMiddle,
    };
    for (const deleteType of [DeleteType.First, DeleteType.Last, DeleteType.Middle]) {
      for (const className of ["Set", "OrderedSet"]) {
        const runsFactor = 1000;
        itBench({
          id: `${className} add up to ${length} items then delete ${deleteType}`,
          fn: () => {
            for (let i = 0; i < runsFactor; i++) {
              const set = className === "Set" ? new Set<number>() : new OrderedSet<number>();
              for (let j = 0; j < length; j++) {
                set.add(j);
              }
              let i = 0;
              while (set.size > 0) {
                const item = itemsToDelete[deleteType][i];
                if (item === undefined) {
                  throw Error(`No item to delete for index ${i}, set size ${set.size}`);
                }
                if (deleteType === DeleteType.First) {
                  set.delete(item, true);
                } else {
                  set.delete(item, false);
                }
                i++;
              }
            }
          },
          runsFactor,
        });
      }
    }
  }
});
