import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {bigIntToBytes, bytesToBigInt, bytesToInt, intToBytes} from "../../src/bytes.js";

describe("bytesToInt", () => {
  const runsFactor = 1000;
  // bound to Math.pow(2, 48) because that matches Buffer api max value and that matches our use case
  const maxValue = Math.pow(2, 48);
  setBenchOpts({
    minMs: 10_000,
  });

  itBench({
    id: "intToBytes",
    beforeEach: () => Math.floor(Math.random() * maxValue),
    fn: (value) => {
      for (let i = 0; i < runsFactor; i++) {
        intToBytes(value, 8);
      }
    },
    runsFactor,
  });

  // old implementation of intToBytes
  itBench({
    id: "bigIntToBytes",
    beforeEach: () => Math.floor(Math.random() * maxValue),
    fn: (value) => {
      for (let i = 0; i < runsFactor; i++) {
        bigIntToBytes(BigInt(value), 8);
      }
    },
    runsFactor,
  });

  itBench({
    id: "bytesToInt",
    beforeEach: () => Math.floor(Math.random() * maxValue),
    fn: (value) => {
      const length = 8;
      const bytes = intToBytes(value, length);
      for (let i = 0; i < runsFactor; i++) {
        bytesToInt(bytes);
      }
    },
    runsFactor,
  });

  itBench({
    // old implementation of bytesToInt
    id: "bytesToBigInt",
    beforeEach: () => Math.floor(Math.random() * maxValue),
    fn: (value) => {
      const length = 8;
      const bytes = intToBytes(value, length);
      for (let i = 0; i < runsFactor; i++) {
        bytesToBigInt(bytes);
      }
    },
    runsFactor,
  });
});
