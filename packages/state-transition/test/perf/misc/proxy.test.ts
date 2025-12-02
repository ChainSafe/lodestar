import {bench, describe} from "@chainsafe/benchmark";

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
      }
      return target[p as unknown as number];
    },
  });

  const wrappedArray = {
    array,
    get(i: number) {
      return this.array[i];
    },
  };

  bench(`regular array get ${n} times`, () => {
    for (let i = 0; i < n; i++) array[i];
  });

  bench(`wrappedArray get ${n} times`, () => {
    for (let i = 0; i < n; i++) wrappedArray.get(i);
  });

  bench(`arrayWithProxy get ${n} times`, () => {
    for (let i = 0; i < n; i++) arrayWithProxy[i];
  });
});
