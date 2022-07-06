import {itBench} from "@dapplion/benchmark";
import {expect} from "chai";

describe("Proxy cost", () => {
  const n = 100_000;
  const array: number[] = [];
  for (let i = 0; i < n; i++) {
    array.push(i);
  }

  const arrayWithProxy = new Proxy(array, {
    get(target, p) {
      if (p === "length") {
        return target.length;
      } else {
        return target[(p as unknown) as number];
      }
    },
  });

  const wrappedArray = {
    array,
    get(i: number) {
      return this.array[i];
    },
  };

  it("Check is correct", () => {
    for (const i of [0, 1, Math.floor(n / 2)]) {
      expect(array[i]).to.equal(i, `Wrong value array[${i}]`);
      expect(arrayWithProxy[i]).to.equal(i, `Wrong value arrayWithProxy[${i}]`);
    }
  });

  itBench(`regular array get ${n} times`, () => {
    for (let i = 0; i < n; i++) array[i];
  });

  itBench(`wrappedArray get ${n} times`, () => {
    for (let i = 0; i < n; i++) wrappedArray.get(i);
  });

  itBench(`arrayWithProxy get ${n} times`, () => {
    for (let i = 0; i < n; i++) arrayWithProxy[i];
  });
});
