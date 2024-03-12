import {randomBytes} from "node:crypto";
import * as snappyjs from "snappyjs";
import * as snappy from "snappy";
import {itBench} from "@dapplion/benchmark";

describe("network / gossip / snappy", () => {
  const msgLens = [100, 200, 300, 400, 500, 1000, 10000, 100000];
  describe("compress", () => {
    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - compress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.compress(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.compressSync(uncompressed);
          }
        },
      });
    }
  });
  describe("uncompress", () => {
    for (const msgLen of [100, 200, 300, 400, 500, 1000, 10000, 100000]) {
      const uncompressed = randomBytes(msgLen);
      const compressed = snappyjs.compress(uncompressed);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - uncompress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.uncompress(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.uncompressSync(compressed);
          }
        },
      });
    }
  });
});
