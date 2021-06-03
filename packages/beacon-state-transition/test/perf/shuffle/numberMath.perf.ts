import {BenchmarkRunner} from "@chainsafe/lodestar-utils";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function () {
  const runner = new BenchmarkRunner("shuffle number math ops", {
    runs: 512,
    maxMs: 10 * 1000,
  });

  const forRuns = 100e5;
  const j = forRuns / 2;

  const arrSize = forRuns;
  const input: number[] = [];
  const inputUint32Array = new Uint32Array(arrSize);
  for (let i = 0; i < arrSize; i++) {
    input[i] = i;
    inputUint32Array[i] = i;
  }

  await runner.run({
    id: "if(i == 1)",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        if (i === 1) {
          //
        }
      }
    },
  });

  await runner.run({
    id: "if(i)",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        if (i) {
          //
        }
      }
    },
  });

  await runner.run({
    id: "i == j",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        i == j;
      }
    },
  });

  await runner.run({
    id: "i === j",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        i === j;
      }
    },
  });

  await runner.run({
    id: "bit opts",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        (j & 0x7) == 0x7;
      }
    },
  });

  await runner.run({
    id: "modulo",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        j % 8 == 0;
      }
    },
  });

  await runner.run({
    id: ">> 3",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        j >> 3;
      }
    },
  });

  await runner.run({
    id: "/ 8",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        j / 8;
      }
    },
  });

  await runner.run({
    id: "swap item in array",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        const tmp = input[forRuns - i];
        input[forRuns - i] = input[i];
        input[i] = tmp;
      }
    },
  });

  await runner.run({
    id: "swap item in Uint32Array",
    run: () => {
      for (let i = 0; i < forRuns; i++) {
        const tmp = inputUint32Array[forRuns - i];
        inputUint32Array[forRuns - i] = inputUint32Array[i];
        inputUint32Array[i] = tmp;
      }
    },
  });
})();
