import {itBench} from "@dapplion/benchmark";

/*
July 14, 2024
- AMD Ryzen Threadripper 1950X 16-Core Processor
- Linux 5.15.0-113-generic
- Node v20.12.2

  array
    ✔ Array.fill - length 1000000                                         148.1271 ops/s    6.750961 ms/op        -        109 runs   1.24 s
    ✔ Array push - length 1000000                                         35.63945 ops/s    28.05879 ms/op        -        158 runs   4.97 s
    ✔ Array.get                                                        2.002555e+9 ops/s   0.4993620 ns/op        -         66 runs   7.96 s
    ✔ Uint8Array.get                                                   2.002383e+9 ops/s   0.4994050 ns/op        -        512 runs  0.903 s
*/

describe("array", () => {
  const N = 1_000_000;
  itBench({
    id: `Array.fill - length ${N}`,
    fn: () => {
      new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        void 0;
      }
    },
  });
  itBench({
    id: `Array push - length ${N}`,
    fn: () => {
      const arr: boolean[] = [];
      for (let i = 0; i < N; i++) {
        arr.push(true);
      }
    },
  });
  itBench({
    id: "Array.get",
    runsFactor: N,
    beforeEach: () => {
      return new Array<number>(N).fill(8);
    },
    fn: (arr) => {
      for (let i = 0; i < N; i++) {
        arr[N - 1];
      }
    },
  });
  itBench({
    id: "Uint8Array.get",
    runsFactor: N,
    beforeEach: () => {
      return new Uint8Array(N);
    },
    fn: (arr) => {
      for (let i = 0; i < N; i++) {
        arr[N - 1];
      }
    },
  });
});
