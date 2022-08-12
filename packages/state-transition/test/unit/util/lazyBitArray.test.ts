import {expect} from "chai";
import {buildLazyBitArray} from "../../../src/util/lazyBitArray.js";

describe("LazyBitArray creation", function () {
  const testCases: {name: string; booleanArr: boolean[]}[] = [
    {name: "all true", booleanArr: Array.from({length: 19}, () => true)},
    {name: "all false", booleanArr: Array.from({length: 19}, () => false)},
    {name: "true every 2 bits", booleanArr: Array.from({length: 19}, (_, i) => i % 2 === 0)},
    {name: "true every 3 bits", booleanArr: Array.from({length: 19}, (_, i) => i % 3 === 0)},
    {name: "true every 4 bits", booleanArr: Array.from({length: 19}, (_, i) => i % 4 === 0)},
    {name: "true every 5 bits", booleanArr: Array.from({length: 19}, (_, i) => i % 5 === 0)},
  ];

  for (const {name, booleanArr} of testCases) {
    it(name, () => {
      const bitArray = buildLazyBitArray(booleanArr);
      for (let i = 0; i < booleanArr.length; i++) {
        expect(bitArray.get(i)).to.be.equal(booleanArr[i], `incorrect bit ${i}`);
      }
    });
  }
});
