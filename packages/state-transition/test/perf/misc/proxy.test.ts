import {bench, describe} from "@chainsafe/benchmark";

/**
 * V8 Proxy-overhead reference microbenchmark. Kept for ad-hoc evaluation only — these are
 * tight 100K-iteration hot loops with no per-iteration work besides the property read, so
 * results are dominated by V8 inline-cache and engine-version effects and have very high
 * run-to-run variance on the shared CI runner (e.g. `arrayWithProxy get 100000 times`
 * tripped a 3.73x alert on PR #9494 with no Lodestar code change touching this path).
 *
 * No `src/` code uses `new Proxy(...)` so this isn't tracking a real regression surface;
 * skip in CI to stop generating false-positive alerts on unrelated PRs. Switch to
 * `bench(...)` locally if you want to take a measurement.
 */
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

  bench.skip(`regular array get ${n} times`, () => {
    for (let i = 0; i < n; i++) array[i];
  });

  bench.skip(`wrappedArray get ${n} times`, () => {
    for (let i = 0; i < n; i++) wrappedArray.get(i);
  });

  bench.skip(`arrayWithProxy get ${n} times`, () => {
    for (let i = 0; i < n; i++) arrayWithProxy[i];
  });
});
