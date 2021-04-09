import {BenchmarkRunner} from "../runner";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function () {
  const runner = new BenchmarkRunner("shuffle list", {
    runs: 512,
    maxMs: 10 * 1000,
  });

  const j = 12354233;
  const forRuns = 1e5;

  const input: number[] = [];
  for (let i = 0; i < 2e5; i++) input[i] = i;

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
        const tmp = input[j];
        input[j] = input[i];
        input[i] = tmp;
      }
    },
  });
})();
