import {itBench} from "@dapplion/benchmark";

describe("array", () => {
  const N = 1_000_000;
  itBench({
    id: "Array.fill",
    fn: () => {
      const arr = new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        void 0;
      }
    },
  });
  itBench({
    id: "Array push",
    fn: () => {
      const arr: boolean[] = [];
      for (let i = 0; i < N; i++) {
        arr.push(true);
      }
    },
  });
  itBench({
    id: "Array.get",
    beforeEach: () => {
      return new Array<number>(N).fill(8);
    },
    fn: (arr) => {
      arr[N - 1];
    },
  });
  itBench({
    id: "Uint8Array.get",
    beforeEach: () => {
      return new Uint8Array(N);
    },
    fn: (arr) => {
      arr[N - 1];
    },
  });
});
