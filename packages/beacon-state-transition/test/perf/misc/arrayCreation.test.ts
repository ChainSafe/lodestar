import {profilerLogger} from "../../utils/logger.js";

describe.skip("array creation", function () {
  const logger = profilerLogger();
  const testCases: {id: string; fn: (n: number) => void}[] = [
    {
      id: "Array.from(() => 0)",
      fn: (n) => Array.from({length: n}, () => 0),
    },
    {
      id: "Array.from().fill(0)",
      fn: (n) => Array.from({length: n}).fill(0),
    },
    {
      id: "Array.from()",
      fn: (n) => Array.from({length: n}),
    },
    {
      id: "new Array()",
      fn: (n) => new Array<number>(n),
    },
    {
      id: "new Array(); for loop",
      fn: (n) => {
        const a = new Array(n);
        for (let i = 0; i < n; ++i) a[i] = 0;
      },
    },
  ];

  for (const {id, fn} of testCases) {
    it(id, () => {
      const opsRun = 10;
      const elem = 200_000;

      const from = process.hrtime.bigint();
      for (let i = 0; i < opsRun; i++) {
        fn(elem);
      }
      const to = process.hrtime.bigint();
      const diffMs = Number(to - from) / 1e6;
      logger.info(`${id}: ${diffMs / opsRun} ms`);
    });
  }
});
