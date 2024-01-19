import {itBench} from "@dapplion/benchmark";

describe.skip("shuffle number math ops", () => {
  const forRuns = 100e5;
  const j = forRuns / 2;

  const arrSize = forRuns;
  const input: number[] = [];
  const inputUint32Array = new Uint32Array(arrSize);
  for (let i = 0; i < arrSize; i++) {
    input[i] = i;
    inputUint32Array[i] = i;
  }

  itBench("if(i == 1)", () => {
    for (let i = 0; i < forRuns; i++) {
      if (i === 1) {
        //
      }
    }
  });

  itBench("if(i)", () => {
    for (let i = 0; i < forRuns; i++) {
      if (i) {
        //
      }
    }
  });

  itBench("i == j", () => {
    for (let i = 0; i < forRuns; i++) {
      i == j;
    }
  });

  itBench("i === j", () => {
    for (let i = 0; i < forRuns; i++) {
      i === j;
    }
  });

  itBench("bit opts", () => {
    for (let i = 0; i < forRuns; i++) {
      (j & 0x7) == 0x7;
    }
  });

  itBench("modulo", () => {
    for (let i = 0; i < forRuns; i++) {
      j % 8 == 0;
    }
  });

  itBench(">> 3", () => {
    for (let i = 0; i < forRuns; i++) {
      j >> 3;
    }
  });

  itBench("/ 8", () => {
    for (let i = 0; i < forRuns; i++) {
      j / 8;
    }
  });

  itBench("swap item in array", () => {
    for (let i = 0; i < forRuns; i++) {
      const tmp = input[forRuns - i];
      input[forRuns - i] = input[i];
      input[i] = tmp;
    }
  });

  itBench("swap item in Uint32Array", () => {
    for (let i = 0; i < forRuns; i++) {
      const tmp = inputUint32Array[forRuns - i];
      inputUint32Array[forRuns - i] = inputUint32Array[i];
      inputUint32Array[i] = tmp;
    }
  });
});
