import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {LinkedList} from "../../../src/util/array";

/**
 * 16_000 items: push then shift  - LinkedList is >200x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 * 24_000 items: push then shift  - LinkedList is >350x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 */
describe("LinkedList vs Regular Array", () => {
  setBenchOpts({noThreshold: true});

  const arrayLengths = [16_000, 24_000];

  for (const length of arrayLengths) {
    itBench({
      id: `array of ${length} items push then shift`,
      beforeEach: () => Array.from({length}, (_, i) => i),
      fn: (arr) => {
        for (let i = 0; i < 1000; i++) {
          arr.push(i);
          arr.shift();
        }
      },
      runsFactor: 1000,
    });

    itBench({
      id: `LinkedList of ${length} items push then shift`,
      beforeEach: () => {
        const linkedList = new LinkedList<number>();
        for (let i = 0; i < length; i++) linkedList.push(i);
        return linkedList;
      },
      fn: (arr) => {
        for (let i = 0; i < 1000; i++) {
          arr.push(i);
          arr.shift();
        }
      },
      runsFactor: 1000,
    });

    itBench({
      id: `array of ${length} items push then pop`,
      beforeEach: () => Array.from({length}, (_, i) => i),
      fn: (arr) => {
        for (let i = 0; i < 1000; i++) {
          arr.push(i);
          arr.pop();
        }
      },
      runsFactor: 1000,
    });

    itBench({
      id: `LinkedList of ${length} items push then pop`,
      beforeEach: () => {
        const linkedList = new LinkedList<number>();
        for (let i = 0; i < length; i++) linkedList.push(i);
        return linkedList;
      },
      fn: (arr) => {
        for (let i = 0; i < 1000; i++) {
          arr.push(i);
          arr.pop();
        }
      },
      runsFactor: 1000,
    });
  }
});
