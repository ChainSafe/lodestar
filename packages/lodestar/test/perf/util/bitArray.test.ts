import {BitArray} from "@chainsafe/ssz";
import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {intersectUint8Arrays} from "../../../src/util/bitArray.js";

/**
 * 16_000 items: push then shift  - LinkedList is >200x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 * 24_000 items: push then shift  - LinkedList is >350x faster than regular array
 *               push then pop - LinkedList is >10x faster than regular array
 */
describe("Intersect BitArray vs Array+Set", () => {
  setBenchOpts({noThreshold: true});

  for (const bitLen of [8 * 1, 8 * 16]) {
    const aBA = BitArray.fromBoolArray(Array.from({length: bitLen}, (_, i) => i % 2 === 0));
    const bBA = BitArray.fromBoolArray(Array.from({length: bitLen}, (_, i) => i % 4 === 0));

    itBench({
      id: `intersect bitArray bitLen ${bitLen}`,
      runsFactor: 1000,
      fn: () => {
        for (let i = 0; i < 1000; i++) {
          intersectUint8Arrays(aBA.uint8Array, bBA.uint8Array);
        }
      },
    });

    const setValid = new Set(linspace(0, bitLen, 2));
    const indices = Array.from({length: bitLen}, (_, i) => i);

    itBench({
      id: `intersect array and set length ${bitLen}`,
      runsFactor: 1000,
      fn: () => {
        for (let i = 0; i < 1000; i++) {
          const intersected: number[] = [];
          for (let i = 0; i < indices.length; i++) {
            if (setValid.has(indices[i])) {
              intersected.push(indices[i]);
            }
          }
        }
      },
    });
  }
});

function linspace(start: number, end: number, step: number): number[] {
  const arr: number[] = [];
  for (let i = start; i < end; i += step) {
    arr.push(i);
  }
  return arr;
}
